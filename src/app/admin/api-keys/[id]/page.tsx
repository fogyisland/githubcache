import { notFound } from 'next/navigation';
import { getApiKeyById } from '@/lib/db/api-keys';
import { LimitsForm } from './_components/limits-form';
import { KeyActions } from './_components/key-actions';
import type { ReactElement } from 'react';

export default async function AdminApiKeyDetailPage({
  params,
}: {
  params: { id: string };
}): Promise<ReactElement> {
  const id = BigInt(params.id);
  const key = await getApiKeyById(id);
  if (!key) notFound();

  return (
    <div>
      <h1>{key.name}</h1>
      <dl>
        <dt>Prefix</dt>
        <dd>
          <code>{key.keyPrefix}…</code> (full key never displayed)
        </dd>
        <dt>Owner</dt>
        <dd>
          {key.user.email} ({key.user.role})
        </dd>
        <dt>Status</dt>
        <dd>{key.status}</dd>
        <dt>Created</dt>
        <dd>{key.createdAt.toISOString()}</dd>
        <dt>Approved</dt>
        <dd>
          {key.approvedAt?.toISOString() ?? '—'} (by user {key.approvedBy?.toString() ?? '—'})
        </dd>
        <dt>Revoked</dt>
        <dd>{key.revokedAt?.toISOString() ?? '—'}</dd>
        <dt>Last used</dt>
        <dd>{key.lastUsedAt?.toISOString() ?? 'never'}</dd>
        <dt>Requests (last 24h)</dt>
        <dd>{key.requestCountLast24h}</dd>
      </dl>

      <h2>Limits</h2>
      <LimitsForm
        apiKeyId={key.id.toString()}
        currentRateLimit={key.rateLimitPerMin}
        currentDailyQuota={key.dailyQuota}
      />

      <h2>Actions</h2>
      <KeyActions apiKeyId={key.id.toString()} currentStatus={key.status} />

      <p>
        <a href="/admin/api-keys">← Back to API keys</a>
      </p>
    </div>
  );
}