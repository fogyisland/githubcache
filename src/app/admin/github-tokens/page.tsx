import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { listAllTokens } from '@/lib/db/github-tokens';
import { poolHasId } from '@/lib/github/pool';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminPagination } from '@/app/admin/_components/admin-pagination';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AdminTokenTestButton } from '@/app/admin/_components/admin-token-test-button';
import { formatDate } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';
import type { TimezoneId } from '@/lib/timezone/registry';
import { QuotaBar, type QuotaBarToken } from './_components/quota-bar';
import { AddTokenForm } from './_components/add-token-form';
import { TokenActions } from './_components/token-actions';

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

type TokenRow = Awaited<ReturnType<typeof listAllTokens>>['rows'][number];

/**
 * Admin → GitHub Tokens page (M32.5 redesign).
 *
 * Layout: AdminPageHeader → QuotaBar (pool health summary) → AdminTable
 * (one row per token with status chip + usage + test + actions) →
 * AddTokenForm → AdminPagination. Mirrors /admin/api-keys' information
 * density and shares the same `ghc-admin-*` CSS tokens. The previous
 * dark-terminal frame was inconsistent with the rest of the admin
 * surface — M32.5 retires it.
 */
export default async function AdminGithubTokensPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string; offset?: string }>;
}): Promise<ReactElement> {
  const sp = await searchParams;
  const { user } = await requireAdmin();

  const userTz = await resolveRequestTimezone({ dbValue: user.timezone });

  const t = await getTranslations('admin.githubTokens');
  const tPag = await getTranslations('admin.common.pagination');

  const rawLimit = Number(sp.limit ?? PAGE_SIZE_DEFAULT);
  const rawOffset = Number(sp.offset ?? 0);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(PAGE_SIZE_MAX, Math.max(1, rawLimit))
    : PAGE_SIZE_DEFAULT;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const { rows: tokens, total: totalTokens } = await listAllTokens({ skip: offset, take: limit });
  // Quota bar needs the full pool (not just the page) so the segments are
  // proportional to the whole. Same PAGE_SIZE_MAX cap as the page itself.
  const allTokens = await listAllTokens({ skip: 0, take: PAGE_SIZE_MAX });
  const totalQuotaUsed = allTokens.rows.reduce((a, tok) => a + tok.requestsUsed, 0);
  const totalQuotaLimit = allTokens.rows.reduce((a, tok) => a + tok.requestsLimit, 0);
  const quotaPct =
    totalQuotaLimit > 0 ? Math.round((totalQuotaUsed / totalQuotaLimit) * 100) : 0;
  const inPoolCount = allTokens.rows.filter((tok) => poolHasId(tok.id)).length;

  const quotaTokens: QuotaBarToken[] = allTokens.rows.map((tok) => ({
    id: tok.id.toString(),
    label: tok.label,
    requestsUsed: tok.requestsUsed,
    requestsLimit: tok.requestsLimit,
  }));

  const columns: AdminColumn<TokenRow>[] = [
    {
      key: 'status',
      header: t('list.column.status'),
      width: '90px',
      render: (row) => (
        <AdminStatusChip variant={row.status === 'active' ? 'ok' : 'warn'}>
          {row.status === 'active' ? t('status.active') : t('status.disabled')}
        </AdminStatusChip>
      ),
    },
    {
      key: 'label',
      header: t('list.column.label'),
      render: (row) => <Link href={`/admin/github-tokens/${row.id}`}>{row.label}</Link>,
    },
    {
      key: 'prefix',
      header: t('list.column.prefix'),
      width: '110px',
      render: (row) => (
        <code className="ghc-mono">
          {row.tokenFirst4}…{row.tokenLast4}
        </code>
      ),
    },
    {
      key: 'pool',
      header: t('list.column.poolState'),
      width: '110px',
      render: (row) =>
        poolHasId(row.id) ? (
          <AdminStatusChip variant="info">{t('pool.inPool')}</AdminStatusChip>
        ) : (
          <AdminStatusChip variant="neutral">{t('pool.notInPool')}</AdminStatusChip>
        ),
    },
    {
      key: 'usage',
      header: t('list.column.usedLimit'),
      width: '170px',
      align: 'right',
      render: (row) => formatUsageCell(row.requestsUsed, row.requestsLimit),
    },
    {
      key: 'lastUsed',
      header: t('list.column.lastUsed'),
      width: '140px',
      render: (row) => formatLastUsed(row.lastUsedAt, userTz),
    },
    {
      key: 'test',
      header: t('list.column.test'),
      width: '90px',
      render: (row) => <AdminTokenTestButton tokenId={row.id.toString()} />,
    },
    {
      key: 'actions',
      header: '',
      width: '160px',
      render: (row) => (
        <TokenActions tokenId={row.id.toString()} currentStatus={row.status} />
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

      <section className="ghc-admin-section" aria-label={t('quota.heading')}>
        <h2 className="ghc-admin-section-heading">{t('quota.heading')}</h2>
        <p className="ghc-admin-section-meta">
          <strong>{inPoolCount}</strong> {t('pool.inPool')} ·{' '}
          {totalQuotaUsed.toLocaleString()} / {totalQuotaLimit.toLocaleString()}{' '}
          ({quotaPct}%)
        </p>
        {totalTokens > 0 ? <QuotaBar tokens={quotaTokens} /> : null}
        {totalTokens > 0 && quotaPct >= 80 ? (
          <p className="ghc-admin-warning" role="alert">
            {t('quota.warning', {
              pct: quotaPct,
              used: totalQuotaUsed.toLocaleString(),
              limit: totalQuotaLimit.toLocaleString(),
            })}
          </p>
        ) : null}
      </section>

      <section className="ghc-admin-section" aria-label={t('list.heading')}>
        <h2 className="ghc-admin-section-heading">{t('list.heading')}</h2>
        <AdminTable<TokenRow>
          columns={columns}
          rows={tokens}
          ariaLabel={t('list.ariaLabel')}
          emptyTitle={t('list.empty.title')}
          emptyDescription={t('list.empty.description')}
        />
        {totalTokens > 0 ? (
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
        ) : null}
      </section>

      {totalTokens === 0 ? (
        <p className="ghc-admin-empty-hint">{t('list.empty.hintAddFirst')}</p>
      ) : null}
      <section className="ghc-admin-section" aria-label={t('addHeading')}>
        <h2 className="ghc-admin-section-heading">{t('addHeading')}</h2>
        <AddTokenForm />
      </section>
    </div>
  );
}

function formatUsageCell(used: number, limit: number): ReactElement {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return (
    <span className="ghc-tabular-nums">
      {used.toLocaleString()} / {limit.toLocaleString()}{' '}
      <span className="ghc-admin-meta">({pct}%)</span>
    </span>
  );
}

function formatLastUsed(d: Date | null, tz: TimezoneId): ReactElement {
  if (!d) return <span className="ghc-admin-meta">—</span>;
  return <span className="ghc-tabular-nums">{formatDate(d, tz)}</span>;
}