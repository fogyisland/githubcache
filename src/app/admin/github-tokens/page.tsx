import { getTranslations } from 'next-intl/server';
import type { ReactElement } from 'react';
import { listAllTokens } from '@/lib/db/github-tokens';
import { poolHasId } from '@/lib/github/pool';
import { requireAdmin } from '@/lib/auth/require-admin';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { TerminalFrame } from './_components/terminal-frame';
import { TokenRow } from './_components/token-row';
import { TerminalPagination } from './_components/terminal-pagination';
import { TerminalEmptyState } from './_components/terminal-empty-state';
import { AddTokenForm } from './_components/add-token-form';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

type TokenRowData = Awaited<ReturnType<typeof listAllTokens>>['rows'][number];

const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 200;

/**
 * Admin → GitHub Tokens page (M32 terminal rewrite).
 *
 * Visual: AdminPageHeader (light) → TerminalFrame (dark) containing:
 *   - Pool status summary
 *   - Optional quota warning bar
 *   - Token rows (each a terminal record)
 *   - AddTokenForm
 *   - Pagination
 *
 * AdminShell, AdminSidebar, AdminTable, AdminPagination, AdminStatusChip
 * are reused where possible. CSS overrides are scoped to .ghc-term-frame.
 */
export default async function AdminGithubTokensPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string; offset?: string }> }): Promise<ReactElement> {
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
  const allTokens = await listAllTokens({ skip: 0, take: PAGE_SIZE_MAX });
  const totalQuotaUsed = allTokens.rows.reduce((a, tok) => a + tok.requestsUsed, 0);
  const totalQuotaLimit = allTokens.rows.reduce((a, tok) => a + tok.requestsLimit, 0);
  const quotaPct = totalQuotaLimit > 0 ? Math.round((totalQuotaUsed / totalQuotaLimit) * 100) : 0;

  const inPoolCount = tokens.filter((t) => poolHasId(t.id)).length;

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

      <TerminalFrame title="github.tokens" count={totalTokens}>
        <p className="ghc-term-section-heading">
          <span className="ghc-term-prompt">&gt;</span>pool
        </p>
        <p>
          <span className="ghc-term-info">[{inPoolCount} active]</span>{' '}
          <span className="ghc-term-dim">
            {totalQuotaUsed.toLocaleString()} / {totalQuotaLimit.toLocaleString()} ({quotaPct}%)
          </span>
        </p>

        {totalTokens > 0 && quotaPct >= 80 ? (
          <p className="ghc-term-warn">
            <span className="ghc-term-prompt">!</span>
            {t('quota.warning', {
              pct: quotaPct,
              used: totalQuotaUsed.toLocaleString(),
              limit: totalQuotaLimit.toLocaleString(),
            })}
          </p>
        ) : null}

        {totalTokens === 0 ? (
          <TerminalEmptyState />
        ) : (
          <>
            <p className="ghc-term-section-heading">
              <span className="ghc-term-prompt">&gt;</span>{t('list.heading').toLowerCase()}
            </p>
            <div role="table" aria-label={t('list.ariaLabel')}>
              {tokens.map((tok) => (
                <TokenRow
                  key={tok.id.toString()}
                  token={{
                    id: tok.id,
                    label: tok.label,
                    tokenFirst4: tok.tokenFirst4,
                    tokenLast4: tok.tokenLast4,
                    status: tok.status,
                    requestsUsed: tok.requestsUsed,
                    requestsLimit: tok.requestsLimit,
                    lastUsedAt: tok.lastUsedAt,
                  }}
                  userTz={userTz}
                  t={t}
                />
              ))}
            </div>
            <TerminalPagination
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
          </>
        )}

        {totalTokens > 0 ? (
          <>
            <p className="ghc-term-section-heading">
              <span className="ghc-term-prompt">&gt;</span>{t('addHeading').toLowerCase()}
            </p>
            <AddTokenForm />
          </>
        ) : null}
      </TerminalFrame>
    </div>
  );
}
