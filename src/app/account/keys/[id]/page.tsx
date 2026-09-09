import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { queryAuditLog } from '@/lib/db/audit';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import { RevokeOwnKeyButton } from './_components/revoke-button';

/**
 * M26 — /account/keys/[id].
 *
 * Accessible only to the key's owner or an admin. Renders the same
 * profile fields as the admin key detail but without the admin-only
 * actions (approve / edit limits). The owner can self-revoke from
 * here.
 *
 * M26.x — styling routed through ghc-* classes (ghc-card,
 * ghc-eyebrow, ghc-chip-status, ghc-text-muted) for theme consistency
 * with the rest of the account surface.
 */
export default async function AccountKeyDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<ReactElement> {
  const cookieStore = await cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (!user) return <></>;

  let id: bigint;
  try {
    id = BigInt(params.id);
  } catch {
    notFound();
  }

  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) notFound();
  if (key.userId !== user.id && user.role !== 'admin') {
    notFound();
  }

  const t = await getTranslations('account.keys.detail');
  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const audit = await queryAuditLog({
    targetType: 'api_key',
    limit: 20,
    offset: 0,
  });
  const filteredAudit = audit.rows.filter((r) => r.targetId === id.toString());

  const chipVariant: 'ok' | 'warn' | 'danger' =
    key.status === 'active' ? 'ok' : key.status === 'pending' ? 'warn' : 'danger';

  return (
    <div className="ghc-fade-up flex flex-col gap-6">
      <header>
        <p className="ghc-eyebrow">{t('eyebrow')}</p>
        <h2 className="mt-1 text-2xl font-semibold">{key.name}</h2>
        <p className="mt-1 text-sm ghc-text-muted">{t('subtitle')}</p>
      </header>

      <section className="ghc-card p-6">
        <dl className="ghc-detail-dl">
          <Row label={t('prefix')} value={<code className="ghc-input-mono">{key.keyPrefix}…</code>} />
          <Row
            label={t('status')}
            value={
              <span className="ghc-chip-status" data-variant={chipVariant}>
                {key.status}
              </span>
            }
          />
          <Row label={t('created')} value={formatDateTime(key.createdAt, userTz)} />
          <Row
            label={t('approved')}
            value={key.approvedAt ? formatDateTime(key.approvedAt, userTz) : t('dash')}
          />
          <Row
            label={t('lastUsed')}
            value={key.lastUsedAt ? formatDateTime(key.lastUsedAt, userTz) : t('never')}
          />
          <Row
            label={t('rateLimit')}
            value={`${key.rateLimitPerMin}/min · ${key.dailyQuota}/day`}
          />
        </dl>
      </section>

      <section className="ghc-card p-6">
        <h3 className="font-semibold">{t('actions.heading')}</h3>
        <p className="mt-1 text-sm ghc-text-muted">{t('actions.body')}</p>
        <div className="mt-3">
          {key.status !== 'revoked' && <RevokeOwnKeyButton keyId={key.id.toString()} />}
          {key.status === 'revoked' && (
            <span className="text-sm ghc-text-muted">{t('actions.alreadyRevoked')}</span>
          )}
        </div>
      </section>

      <section className="ghc-card p-6">
        <h3 className="font-semibold">{t('history.heading')}</h3>
        {filteredAudit.length === 0 ? (
          <p className="mt-2 text-sm ghc-text-muted">{t('history.empty')}</p>
        ) : (
          <ul className="ghc-history-list">
            {filteredAudit.map((row) => (
              <li key={row.id.toString()} className="ghc-history-row">
                <code>{row.action}</code>
                <span className="ghc-text-muted">
                  {formatDateTime(row.createdAt, userTz)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }): ReactElement {
  return (
    <>
      <dt className="ghc-detail-dt">{label}</dt>
      <dd className="ghc-detail-dd">{value}</dd>
    </>
  );
}
