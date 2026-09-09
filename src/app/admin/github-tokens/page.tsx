import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactElement } from 'react';
import { listAllTokens } from '@/lib/db/github-tokens';
import { poolHasId } from '@/lib/github/pool';
import { validateSession } from '@/lib/auth/session';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AddTokenForm } from './_components/add-token-form';
import { TokenActions } from './_components/token-actions';
import { formatDate } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

type TokenRow = Awaited<ReturnType<typeof listAllTokens>>['rows'][number];

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → GitHub Tokens page (M11.10 rewrite, M14.2 pagination).
 *
 * Admin-only. Shows pool size banner + quota warning (computed across ALL
 * tokens, not just the current page — quota totals use a separate count),
 * then AddTokenForm + AdminTable of tokens. Each row carries a status chip
 * (active/disabled), a pool-state chip (in-pool vs pending activation),
 * used/limit progress, and per-row TokenActions.
 */
export default async function AdminGithubTokensPage({
  searchParams,
}: {
  searchParams: { limit?: string; offset?: string };
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
  if (!user || user.role !== 'admin') {
    redirect('/admin');
  }

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const t = await getTranslations('admin.githubTokens');
  const tPag = await getTranslations('admin.common.pagination');

  const rawLimit = Number(searchParams.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(searchParams.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { rows: tokens, total: totalTokens } = await listAllTokens({ skip: offset, take: limit });

  // Quota totals must include tokens not on the current page so the
  // warning doesn't flap based on which page the admin lands on. We
  // recompute by aggregating across all tokens via a lightweight COUNT
  // + SUM equivalent: fetch all rows just for the totals.
  const allTokens = await listAllTokens({ skip: 0, take: PAGE_SIZE_MAX });
  const totalQuotaUsed = allTokens.rows.reduce((a, tok) => a + tok.requestsUsed, 0);
  const totalQuotaLimit = allTokens.rows.reduce((a, tok) => a + tok.requestsLimit, 0);
  const quotaPct = totalQuotaLimit > 0 ? Math.round((totalQuotaUsed / totalQuotaLimit) * 100) : 0;

  const columns: AdminColumn<TokenRow>[] = [
    { key: 'label', header: t('list.column.label'), render: (tok) => tok.label },
    {
      key: 'prefix',
      header: t('list.column.prefix'),
      render: (tok) => (
        <code className="ghc-admin-mono">
          {tok.tokenFirst4}…{tok.tokenLast4}
        </code>
      ),
    },
    {
      key: 'status',
      header: t('list.column.status'),
      render: (tok) => (
        <AdminStatusChip variant={tok.status === 'active' ? 'ok' : 'warn'}>
          {t(`status.${tok.status}` as 'status.active' | 'status.disabled')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'pool',
      header: t('list.column.poolState'),
      render: (tok) => {
        const inPool = poolHasId(tok.id);
        return (
          <AdminStatusChip variant={inPool ? 'ok' : 'warn'}>
            {inPool ? t('pool.inPool') : t('pool.notInPool')}
          </AdminStatusChip>
        );
      },
    },
    {
      key: 'usage',
      header: t('list.column.usedLimit'),
      render: (tok) => {
        const pct = tok.requestsLimit > 0
          ? Math.round((tok.requestsUsed / tok.requestsLimit) * 100)
          : 0;
        return (
          <span className="ghc-admin-usage">
            {tok.requestsUsed.toLocaleString()} / {tok.requestsLimit.toLocaleString()}
            <span className="ghc-admin-usage-pct">({pct}%)</span>
          </span>
        );
      },
      align: 'right',
    },
    {
      key: 'lastUsed',
      header: t('list.column.lastUsed'),
      render: (tok) => (tok.lastUsedAt ? formatDate(tok.lastUsedAt, userTz) : t('list.never')),
    },
    {
      key: 'actions',
      header: '',
      render: (tok) => (
        <TokenActions tokenId={tok.id.toString()} currentStatus={tok.status} />
      ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[
          { label: t('breadcrumbAdmin'), href: '/admin' },
          { label: t('breadcrumbGithubTokens') },
        ]}
        title={t('title')}
        description={t('description')}
      />

      {totalTokens > 0 && quotaPct >= 80 ? (
        <div className="ghc-admin-quota-warning">
          <AdminStatusChip variant="warn">{t('quota.chip')}</AdminStatusChip>
          <span>
            {t('quota.warning', {
              pct: quotaPct,
              used: totalQuotaUsed.toLocaleString(),
              limit: totalQuotaLimit.toLocaleString(),
            })}
          </span>
        </div>
      ) : null}

      <p className="ghc-admin-hint">{t('poolHintBody')}</p>

      <section>
        <h2 className="ghc-admin-section-title">{t('addHeading')}</h2>
        <AddTokenForm />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          {t('list.heading')}{' '}
          <span className="ghc-admin-section-count">({totalTokens})</span>
        </h2>
        <AdminTable<TokenRow>
          columns={columns}
          rows={tokens}
          emptyTitle={t('list.empty.title')}
          emptyDescription={t('list.empty.description')}
          ariaLabel={t('list.ariaLabel')}
        />
        <AdminPagination
          basePath="/admin/github-tokens"
          offset={offset}
          limit={limit}
          total={totalTokens}
          rowsOnPage={tokens.length}
          label={tPag('showing', {
            start: totalTokens === 0 ? 0 : offset + 1,
            end: offset + tokens.length,
            total: totalTokens,
          })}
        />
      </section>
    </div>
  );
}
