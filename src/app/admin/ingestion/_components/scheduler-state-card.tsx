import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { AdminStatusChip } from '@/app/admin/_components/admin-status-chip';
import { formatDateTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';

interface Props {
  isPaused: boolean;
  pausedAt: Date | null;
  tz: TimezoneId;
}

/**
 * Scheduler state pill for /admin/ingestion. RUNNING/PAUSED + pausedAt
 * timestamp, with a link to /admin/refresh where the admin can actually
 * flip the bit. The link is intentional: this page is read-only by
 * design — the operator must go to the refresh controls to change state.
 */
export async function SchedulerStateCard({
  isPaused,
  pausedAt,
  tz,
}: Props): Promise<ReactElement> {
  const t = await getTranslations('admin.ingestion.scheduler');
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <span className="text-sm text-gray-500">{t('label')}</span>
      <AdminStatusChip variant={isPaused ? 'warn' : 'ok'}>
        {isPaused ? t('paused') : t('running')}
      </AdminStatusChip>
      {isPaused && pausedAt ? (
        <span className="text-sm text-gray-600">
          {t('pausedAt', { when: formatDateTime(pausedAt, tz) })}
        </span>
      ) : null}
      <a
        href="/admin/refresh"
        className="ml-auto text-sm text-blue-600 hover:underline"
      >
        {t('manageLink')}
      </a>
    </div>
  );
}