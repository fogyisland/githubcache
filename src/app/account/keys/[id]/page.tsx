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
 */
export default async function AccountKeyDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<ReactElement> {
  const cookieStore = cookies();
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
  const userTz = resolveRequestTimezone({ dbValue: user.timezone });

  const audit = await queryAuditLog({
    targetType: 'api_key',
    limit: 20,
    offset: 0,
  });
  const filteredAudit = audit.rows.filter((r) => r.targetId === id.toString());

  return (
    <div className="ghc-fade-up flex flex-col gap-6">
      <header>
        <p
          className="font-mono text-xs tracking-[0.2em] uppercase"
          style={{ color: 'var(--color-accent)' }}
        >
          {t('eyebrow')}
        </p>
        <h2 className="mt-1 text-2xl font-semibold">{key.name}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {t('subtitle')}
        </p>
      </header>

      <section className="ghc-card p-6">
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.75rem 1.5rem' }}>
          <Row label={t('prefix')} value={<code>{key.keyPrefix}…</code>} />
          <Row
            label={t('status')}
            value={
              <span
                style={{
                  padding: '0.15rem 0.55rem',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background:
                    key.status === 'active'
                      ? 'var(--color-ok-soft)'
                      : key.status === 'pending'
                      ? 'var(--color-warn-soft)'
                      : 'var(--color-danger-soft)',
                  color:
                    key.status === 'active'
                      ? 'var(--color-ok)'
                      : key.status === 'pending'
                      ? 'var(--color-warn)'
                      : 'var(--color-danger)',
                }}
              >
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
        <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {t('actions.body')}
        </p>
        <div className="mt-3">
          {key.status !== 'revoked' && <RevokeOwnKeyButton keyId={key.id.toString()} />}
          {key.status === 'revoked' && (
            <span className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
              {t('actions.alreadyRevoked')}
            </span>
          )}
        </div>
      </section>

      <section className="ghc-card p-6">
        <h3 className="font-semibold">{t('history.heading')}</h3>
        {filteredAudit.length === 0 ? (
          <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {t('history.empty')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, marginTop: '0.5rem' }}>
            {filteredAudit.map((row) => (
              <li
                key={row.id.toString()}
                style={{
                  padding: '0.4rem 0',
                  borderBottom: '1px solid var(--color-border-subtle, var(--color-border))',
                  fontSize: '0.85rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <code>{row.action}</code>
                <span style={{ color: 'var(--color-ink-muted)' }}>
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
      <dt
        style={{
          fontSize: '0.8rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--color-ink-muted)',
          paddingTop: '0.25rem',
        }}
      >
        {label}
      </dt>
      <dd style={{ fontSize: '0.95rem' }}>{value}</dd>
    </>
  );
}
