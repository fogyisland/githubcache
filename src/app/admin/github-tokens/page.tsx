import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import type { ReactElement } from 'react';
import { listAllTokens } from '@/lib/db/github-tokens';
import { poolHasHash, poolSize } from '@/lib/github/pool';
import { validateSession } from '@/lib/auth/session';
import { AdminPageHeader } from '@/app/admin/_components/admin-page-header';
import { AdminTable, type AdminColumn } from '@/app/admin/_components/admin-table';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { AddTokenForm } from './_components/add-token-form';
import { TokenActions } from './_components/token-actions';

type TokenRow = Awaited<ReturnType<typeof listAllTokens>>[number];

/**
 * Admin → GitHub Tokens page (M11.10 rewrite).
 *
 * Admin-only. Shows pool size banner + quota warning, then AddTokenForm +
 * AdminTable of tokens. Each row carries a status chip (active/disabled),
 * a pool-state chip (in-pool vs pending activation), used/limit progress,
 * and per-row TokenActions.
 */
export default async function AdminGithubTokensPage(): Promise<ReactElement> {
  const cookieStore = cookies();
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

  const t = await getTranslations('admin.githubTokens');

  const tokens = await listAllTokens();
  const activePoolSize = poolSize();
  const totalQuotaUsed = tokens.reduce((a, tok) => a + tok.requestsUsed, 0);
  const totalQuotaLimit = tokens.reduce((a, tok) => a + tok.requestsLimit, 0);
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
        const inPool = poolHasHash(tok.tokenHash);
        return (
          <AdminStatusChip variant={inPool ? 'ok' : 'warn'}>
            {inPool ? t('pool.inPool') : t('pool.pendingActivation')}
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
      render: (tok) => (tok.lastUsedAt ? tok.lastUsedAt.toISOString().slice(0, 10) : t('list.never')),
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

      {tokens.length > 0 && quotaPct >= 80 ? (
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

      <p className="ghc-admin-hint">
        {t.rich('poolHint', {
          size: () => <strong>{activePoolSize}</strong>,
          env: () => <code>GITHUB_TOKENS</code>,
          envFile: () => <code>GITHUB_TOKENS_FILE</code>,
        })}
      </p>

      <section>
        <h2 className="ghc-admin-section-title">{t('addHeading')}</h2>
        <AddTokenForm />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          {t('list.heading')}{' '}
          <span className="ghc-admin-section-count">({tokens.length})</span>
        </h2>
        <AdminTable<TokenRow>
          columns={columns}
          rows={tokens}
          emptyTitle={t('list.empty.title')}
          emptyDescription={t('list.empty.description')}
          ariaLabel={t('list.ariaLabel')}
        />
      </section>
    </div>
  );
}
