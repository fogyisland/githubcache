import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { AdminJobCard } from './admin-job-card';
import { AdminEmptyState } from './admin-empty-state';
import type { TimezoneId } from '@/lib/timezone/registry';

export interface PendingJobRow {
  id: bigint;
  // M31 — repositoryId may be null (queue-on-miss, no repositories row).
  repositoryId: bigint | null;
  status: string;
  attempts: number;
  createdAt: Date;
  lastError: string | null;
  // M31 — owner/name live directly on the RefreshJob row (the relation
  // to `repositories` was dropped in Task 1).
  owner: string;
  name: string;
}

interface Props {
  pending: PendingJobRow[];
  userTz: TimezoneId;
}

/**
 * Server component — card-based grid that replaces the legacy pending-jobs
 * table on /admin/queue. Each card is an `AdminJobCard` (also a server
 * component) so the render stays SSR-friendly; only the inline retry /
 * cancel buttons hydrate as client islands.
 *
 * When there are no pending jobs we render an `AdminEmptyState` so the
 * grid slot doesn't collapse to zero-height, which would leave the
 * operator unsure whether the page rendered correctly.
 */
export async function AdminJobCardGrid({ pending, userTz }: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.queue');

  if (pending.length === 0) {
    return (
      <AdminEmptyState
        icon={<span aria-hidden="true">·</span>}
        title={t('emptyTitle')}
        description={t('emptyDescription')}
      />
    );
  }

  return (
    <div className="ghc-admin-job-card-grid">
      {pending.map((job) => (
        <AdminJobCard key={job.id.toString()} job={job} userTz={userTz} />
      ))}
    </div>
  );
}
