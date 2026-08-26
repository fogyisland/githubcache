import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
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

  const tokens = await listAllTokens();
  const activePoolSize = poolSize();
  const totalQuotaUsed = tokens.reduce((a, t) => a + t.requestsUsed, 0);
  const totalQuotaLimit = tokens.reduce((a, t) => a + t.requestsLimit, 0);
  const quotaPct = totalQuotaLimit > 0 ? Math.round((totalQuotaUsed / totalQuotaLimit) * 100) : 0;

  const columns: AdminColumn<TokenRow>[] = [
    { key: 'label', header: 'Label', render: (t) => t.label },
    {
      key: 'prefix',
      header: 'Prefix',
      render: (t) => (
        <code className="ghc-admin-mono">
          {t.tokenFirst4}…{t.tokenLast4}
        </code>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => (
        <AdminStatusChip variant={t.status === 'active' ? 'ok' : 'warn'}>
          {t.status}
        </AdminStatusChip>
      ),
    },
    {
      key: 'pool',
      header: 'Pool state',
      render: (t) => {
        const inPool = poolHasHash(t.tokenHash);
        return (
          <AdminStatusChip variant={inPool ? 'ok' : 'warn'}>
            {inPool ? 'in pool' : 'pending activation'}
          </AdminStatusChip>
        );
      },
    },
    {
      key: 'usage',
      header: 'Used / Limit',
      render: (t) => {
        const pct = t.requestsLimit > 0
          ? Math.round((t.requestsUsed / t.requestsLimit) * 100)
          : 0;
        return (
          <span className="ghc-admin-usage">
            {t.requestsUsed.toLocaleString()} / {t.requestsLimit.toLocaleString()}
            <span className="ghc-admin-usage-pct">({pct}%)</span>
          </span>
        );
      },
      align: 'right',
    },
    {
      key: 'lastUsed',
      header: 'Last used',
      render: (t) => (t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 10) : '—'),
    },
    {
      key: 'actions',
      header: '',
      render: (t) => (
        <TokenActions tokenId={t.id.toString()} currentStatus={t.status} />
      ),
    },
  ];

  return (
    <div className="ghc-admin-page">
      <AdminPageHeader
        breadcrumb={[{ label: 'Admin', href: '/admin' }, { label: 'GitHub Tokens' }]}
        title="GitHub Tokens"
        description="Manage the GitHub token pool used by the refresh scheduler."
      />

      {tokens.length > 0 && quotaPct >= 80 ? (
        <div className="ghc-admin-quota-warning">
          <AdminStatusChip variant="warn">quota</AdminStatusChip>
          <span>
            {quotaPct}% of combined token quota used ({totalQuotaUsed.toLocaleString()} /{' '}
            {totalQuotaLimit.toLocaleString()}).
          </span>
        </div>
      ) : null}

      <p className="ghc-admin-hint">
        Pool size (currently active in memory): <strong>{activePoolSize}</strong>.
        Adding a token here creates a DB record only — to activate it, add the token to{' '}
        <code>GITHUB_TOKENS</code> env var or <code>GITHUB_TOKENS_FILE</code> and restart
        the service.
      </p>

      <section>
        <h2 className="ghc-admin-section-title">Add a token</h2>
        <AddTokenForm />
      </section>

      <section>
        <h2 className="ghc-admin-section-title">
          Registered tokens <span className="ghc-admin-section-count">({tokens.length})</span>
        </h2>
        <AdminTable<TokenRow>
          columns={columns}
          rows={tokens}
          emptyTitle="No GitHub tokens registered"
          emptyDescription="Add one with the form above to enable refresh."
          ariaLabel="GitHub tokens"
        />
      </section>
    </div>
  );
}