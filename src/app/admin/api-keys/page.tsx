import { listApiKeys } from '@/lib/db/api-keys';
import { StatusFilter } from './_components/status-filter';
import type { ApiKeyStatus } from '@prisma/client';
import type { ReactElement } from 'react';

export default async function AdminApiKeysPage({
  searchParams,
}: {
  searchParams: { status?: string };
}): Promise<ReactElement> {
  const filterStatus: ApiKeyStatus | undefined =
    searchParams.status === 'pending' ||
    searchParams.status === 'active' ||
    searchParams.status === 'revoked'
      ? searchParams.status
      : undefined;

  const keys = await listApiKeys(filterStatus ? { status: filterStatus } : undefined);

  return (
    <div>
      <h1>API Keys</h1>
      <StatusFilter current={filterStatus ?? 'all'} />
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Prefix</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Rate/min</th>
            <th>Daily quota</th>
            <th>Last used</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.length === 0 ? (
            <tr>
              <td colSpan={9}>No API keys found.</td>
            </tr>
          ) : (
            keys.map((k) => (
              <tr key={k.id.toString()}>
                <td>
                  <a href={`/admin/api-keys/${k.id}`}>{k.name}</a>
                </td>
                <td>
                  <code>{k.keyPrefix}…</code>
                </td>
                <td>{k.user.email}</td>
                <td>{k.status}</td>
                <td>{k.rateLimitPerMin}</td>
                <td>{k.dailyQuota}</td>
                <td>{k.lastUsedAt?.toISOString() ?? '—'}</td>
                <td>{k.createdAt.toISOString()}</td>
                <td>
                  <a href={`/admin/api-keys/${k.id}`}>Manage</a>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}