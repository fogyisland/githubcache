import { cookies } from 'next/headers';
import type { ReactElement } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ApiKeyStatus } from '@prisma/client';
import { validateSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/client';
import { formatDate, formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

const PAGE_SIZE = 50;

type StatusFilter = ApiKeyStatus | 'all';

function parseStatusFilter(raw: string | undefined): StatusFilter {
  if (raw === 'pending' || raw === 'active' || raw === 'revoked') return raw;
  return 'all';
}

/**
 * M26 — /account/keys.
 *
 * Lists the signed-in user's API keys with optional status filter
 * (URL-synced, like the admin filter bar pattern). Reads session from
 * cookies; layout already redirected if absent.
 */
export default async function AccountKeysPage({
  searchParams,
}: {
  searchParams: { status?: string };
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

  const t = await getTranslations('account.keys');
  const tList = await getTranslations('admin.common.pagination');
  const userTz = resolveRequestTimezone({ dbValue: user.timezone });

  const filter = parseStatusFilter(searchParams.status);
  const where: { userId: bigint; status?: ApiKeyStatus } = { userId: user.id };
  if (filter !== 'all') where.status = filter;

  const keys = await prisma.apiKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE,
  });

  const statusChip: Record<ApiKeyStatus, { bg: string; fg: string }> = {
    active: { bg: 'var(--color-ok-soft)', fg: 'var(--color-ok)' },
    pending: { bg: 'var(--color-warn-soft)', fg: 'var(--color-warn)' },
    revoked: { bg: 'var(--color-danger-soft)', fg: 'var(--color-danger)' },
  };

  return (
    <div className="ghc-fade-up flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-semibold">{t('heading')}</h2>
        <Link href="/account/keys/request" className="ghc-btn-primary">
          {t('requestButton')}
        </Link>
      </header>

      <nav aria-label={t('filterAria')} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {(['all', 'active', 'pending', 'revoked'] as StatusFilter[]).map((s) => {
          const active = s === filter;
          const href = s === 'all' ? '/account/keys' : `/account/keys?status=${s}`;
          return (
            <Link
              key={s}
              href={href}
              aria-current={active ? 'page' : undefined}
              className="ghc-pill-link"
              data-active={active}
              style={{
                padding: '0.3rem 0.7rem',
                borderRadius: '999px',
                textDecoration: 'none',
                fontSize: '0.85rem',
                background: active ? 'var(--color-accent-soft)' : 'transparent',
                color: active ? 'var(--color-accent)' : 'var(--color-ink)',
                border: '1px solid var(--color-border)',
              }}
            >
              {t(`status.${s}` as 'status.all')}
            </Link>
          );
        })}
      </nav>

      {keys.length === 0 ? (
        <div className="ghc-card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--color-ink-muted)' }}>
            {t('empty')}
          </p>
          <Link href="/account/keys/request" className="ghc-btn-primary mt-4">
            {t('requestButton')}
          </Link>
        </div>
      ) : (
        <div className="ghc-card overflow-x-auto">
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>{t('columns.name')}</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>{t('columns.prefix')}</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>{t('columns.status')}</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>{t('columns.created')}</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>{t('columns.approved')}</th>
                <th style={{ textAlign: 'left', padding: '0.6rem 0.75rem' }}>{t('columns.lastUsed')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const chip = statusChip[k.status];
                return (
                  <tr
                    key={k.id.toString()}
                    style={{ borderBottom: '1px solid var(--color-border-subtle, var(--color-border))' }}
                  >
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <Link href={`/account/keys/${k.id}`} className="ghc-link">
                        {k.name}
                      </Link>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <code style={{ fontFamily: 'Menlo, Consolas, monospace', fontSize: '0.85rem' }}>
                        {k.keyPrefix}…
                      </code>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem' }}>
                      <span
                        style={{
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          background: chip.bg,
                          color: chip.fg,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        {t(`status.${k.status}` as 'status.pending')}
                      </span>
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
                      {formatDate(k.createdAt, userTz)}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
                      {k.approvedAt ? formatDateTime(k.approvedAt, userTz) : t('dash')}
                    </td>
                    <td style={{ padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}>
                      {k.lastUsedAt ? formatDateTime(k.lastUsedAt, userTz) : t('never')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p
            className="px-3 py-2 text-xs"
            style={{ color: 'var(--color-ink-muted)' }}
          >
            {tList('showing', {
              start: keys.length === 0 ? 0 : 1,
              end: keys.length,
              total: keys.length,
            })}
          </p>
        </div>
      )}
    </div>
  );
}
