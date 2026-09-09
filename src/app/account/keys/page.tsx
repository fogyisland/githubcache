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
 *
 * M26.x — styling routed through ghc-* classes (ghc-card, ghc-pill-link,
 * ghc-chip-status, ghc-text-muted) instead of inline color variables.
 * Status chips read their variant from the ghc-chip-status[data-variant]
 * attribute so the same code path works across all themes.
 */
export default async function AccountKeysPage({
  searchParams,
}: {
  searchParams: { status?: string };
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

  const t = await getTranslations('account.keys');
  const tList = await getTranslations('admin.common.pagination');
  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const filter = parseStatusFilter(searchParams.status);
  const where: { userId: bigint; status?: ApiKeyStatus } = { userId: user.id };
  if (filter !== 'all') where.status = filter;

  const keys = await prisma.apiKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: PAGE_SIZE,
  });

  const chipVariant: Record<ApiKeyStatus, 'ok' | 'warn' | 'danger'> = {
    active: 'ok',
    pending: 'warn',
    revoked: 'danger',
  };

  return (
    <div className="ghc-fade-up flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h2 className="text-xl font-semibold">{t('heading')}</h2>
        <Link href="/account/keys/request" className="ghc-btn-primary">
          {t('requestButton')}
        </Link>
      </header>

      <nav
        aria-label={t('filterAria')}
        className="flex flex-wrap gap-2"
      >
        {(['all', 'active', 'pending', 'revoked'] as StatusFilter[]).map((s) => {
          const active = s === filter;
          const href = s === 'all' ? '/account/keys' : `/account/keys?status=${s}`;
          return (
            <Link
              key={s}
              href={href}
              aria-current={active ? 'page' : undefined}
              data-active={active}
              className="ghc-pill-link"
            >
              {t(`status.${s}` as 'status.all')}
            </Link>
          );
        })}
      </nav>

      {keys.length === 0 ? (
        <div className="ghc-card p-8 text-center">
          <p className="text-sm ghc-text-muted">{t('empty')}</p>
          <Link href="/account/keys/request" className="ghc-btn-primary mt-4">
            {t('requestButton')}
          </Link>
        </div>
      ) : (
        <div className="ghc-card overflow-x-auto">
          <table className="ghc-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr className="ghc-table-header-row">
                <th className="ghc-table-th">{t('columns.name')}</th>
                <th className="ghc-table-th">{t('columns.prefix')}</th>
                <th className="ghc-table-th">{t('columns.status')}</th>
                <th className="ghc-table-th">{t('columns.created')}</th>
                <th className="ghc-table-th">{t('columns.approved')}</th>
                <th className="ghc-table-th">{t('columns.lastUsed')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id.toString()} className="ghc-table-row">
                  <td className="ghc-table-td">
                    <Link href={`/account/keys/${k.id}`} className="ghc-link">
                      {k.name}
                    </Link>
                  </td>
                  <td className="ghc-table-td">
                    <code className="ghc-input-mono">{k.keyPrefix}…</code>
                  </td>
                  <td className="ghc-table-td">
                    <span className="ghc-chip-status" data-variant={chipVariant[k.status]}>
                      {t(`status.${k.status}` as 'status.pending')}
                    </span>
                  </td>
                  <td className="ghc-table-td text-sm">
                    {formatDate(k.createdAt, userTz)}
                  </td>
                  <td className="ghc-table-td text-sm">
                    {k.approvedAt ? formatDateTime(k.approvedAt, userTz) : t('dash')}
                  </td>
                  <td className="ghc-table-td text-sm">
                    {k.lastUsedAt ? formatDateTime(k.lastUsedAt, userTz) : t('never')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-xs ghc-text-muted">
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
