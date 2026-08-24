import { listAllTokens } from '@/lib/db/github-tokens';
import { poolHasHash, poolSize } from '@/lib/github/pool';
import { AddTokenForm } from './_components/add-token-form';
import { TokenActions } from './_components/token-actions';
import type { ReactElement } from 'react';

export default async function AdminGithubTokensPage(): Promise<ReactElement> {
  const tokens = await listAllTokens();
  const activePoolSize = poolSize();

  return (
    <div>
      <h1>GitHub Tokens</h1>
      <p>
        Pool size (currently active in memory): <strong>{activePoolSize}</strong>
      </p>
      <p>
        <em>
          Adding a token here creates a DB record only. To activate it, add the token to{' '}
          <code>GITHUB_TOKENS</code> env var or <code>GITHUB_TOKENS_FILE</code> and restart the
          service. Tokens that exist in env/file but not in DB are auto-registered on next restart.
        </em>
      </p>

      <h2>Add a token</h2>
      <AddTokenForm />

      <h2>Registered tokens</h2>
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>First 4</th>
            <th>Last 4</th>
            <th>Status</th>
            <th>Pool state</th>
            <th>Used / Limit</th>
            <th>Last used</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 ? (
            <tr>
              <td colSpan={9}>No tokens registered.</td>
            </tr>
          ) : (
            tokens.map((t) => {
              const inPool = poolHasHash(t.tokenHash);
              return (
                <tr key={t.id.toString()}>
                  <td>{t.label}</td>
                  <td>
                    <code>{t.tokenFirst4}</code>
                  </td>
                  <td>
                    <code>{t.tokenLast4}</code>
                  </td>
                  <td>{t.status}</td>
                  <td>
                    {inPool ? (
                      <span style={{ color: 'green' }}>active in pool</span>
                    ) : (
                      <span style={{ color: 'orange' }}>pending activation</span>
                    )}
                  </td>
                  <td>
                    {t.requestsUsed} / {t.requestsLimit}
                  </td>
                  <td>{t.lastUsedAt?.toISOString() ?? '—'}</td>
                  <td>{t.createdAt.toISOString()}</td>
                  <td>
                    <TokenActions
                      tokenId={t.id.toString()}
                      currentStatus={t.status}
                    />
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
