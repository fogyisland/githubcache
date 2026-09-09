import type { ReactElement } from 'react';
import type { RefreshJobStatus } from '@prisma/client';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/db/client';
import { formatDateTime } from '@/lib/format/datetime';
import { resolveRequestTimezone } from '@/lib/timezone/resolve';

interface RefreshRow {
  id: bigint;
  scheduledFor: Date;
  updatedAt: Date;
  status: RefreshJobStatus;
  priority: number;
  attempts: number;
  lastError: string | null;
}

interface FetchHistoryProps {
  repositoryId: string;
}

const STATUS_CHIP: Record<RefreshJobStatus, string> = {
  done: 'ok',
  failed: 'danger',
  pending: 'neutral',
  in_progress: 'warn',
};

const STATUS_LABEL: Record<RefreshJobStatus, string> = {
  done: 'done',
  failed: 'failed',
  pending: 'pending',
  in_progress: 'in_progress',
};

function outcomeFor(status: RefreshJobStatus): 'success' | 'failed' | 'pending' {
  if (status === 'done') return 'success';
  if (status === 'failed') return 'failed';
  return 'pending';
}

/**
 * "Fetch history" section for the public /repo/[owner]/[name] page (M24).
 * Shows the 5 most recent refresh_jobs for this repo, with status chip,
 * outcome (success / failed / pending), and updated-at timestamp in
 * the viewer's timezone.
 *
 * If `repositoryId` is empty (the parent page hit a race), renders the
 * section with an empty state — never throws.
 */
export async function FetchHistory({
  repositoryId,
}: FetchHistoryProps): Promise<ReactElement> {
  const t = await getTranslations('repo.fetchHistory');
  const tz = await resolveRequestTimezone({});

  if (!repositoryId) {
    return (
      <div className="ghc-card p-5" data-testid="ghc-fetch-history">
        <h2 className="mb-3 flex items-center gap-2 ghc-eyebrow">{t('heading')}</h2>
        <p className="text-sm text-[color:var(--color-ink-muted)]">{t('empty')}</p>
      </div>
    );
  }

  let rows: RefreshRow[] = [];
  try {
    rows = await prisma.refreshJob.findMany({
      where: { repositoryId: BigInt(repositoryId) },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    });
  } catch {
    // BigInt parse failure or DB hiccup — surface the empty state rather
    // than a 500 on the public page.
    rows = [];
  }

  return (
    <div className="ghc-card p-5" data-testid="ghc-fetch-history">
      <h2 className="mb-3 flex items-center gap-2 ghc-eyebrow">{t('heading')}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-[color:var(--color-ink-muted)]">{t('empty')}</p>
      ) : (
        <ul className="divide-y divide-[color:var(--color-rule)]">
          {rows.map((r) => (
            <li
              key={r.id.toString()}
              className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
            >
              <span className="font-mono text-xs text-[color:var(--color-ink-muted)]">
                {formatDateTime(r.updatedAt, tz)}
              </span>
              <span
                className={`ghc-admin-chip ghc-admin-chip-${STATUS_CHIP[r.status]}`}
              >
                {t(`status.${STATUS_LABEL[r.status]}` as 'status.done')}
              </span>
              <span className="text-[color:var(--color-ink-muted)]">
                {t(`outcome.${outcomeFor(r.status)}` as 'outcome.success')}
              </span>
              {r.lastError ? (
                <span
                  className="max-w-md truncate text-xs text-[color:var(--color-ink-muted)]"
                  title={r.lastError}
                >
                  {r.lastError.length > 80
                    ? `${r.lastError.slice(0, 80)}…`
                    : r.lastError}
                </span>
              ) : (
                <span className="text-xs text-[color:var(--color-ink-muted)]">
                  {t('dash')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
