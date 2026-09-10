'use client';

import { useState, useTransition, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { formatDateTime } from '@/lib/format/datetime';
import type { TimezoneId } from '@/lib/timezone/registry';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';

interface BackupRow {
  filename: string;
  size: number;
  mtime: string; // ISO
}

interface Props {
  initialBackups: BackupRow[];
  keepN: number;
  tz: TimezoneId;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

/**
 * M17 — Client component on /admin/database. Holds the backup list
 * (server-rendered initial state, mutated client-side after each
 * create/delete). The "Back up now" button POSTs to
 * /api/admin/database/backup and refreshes the list. Each row has a
 * download link + delete button.
 *
 * CSRF: adminFetch auto-injects the x-csrf-token header. The route
 * also validates body.csrf, which we provide via fetchCsrfToken().
 */
export function BackupSection({ initialBackups, keepN, tz }: Props): ReactElement {
  const t = useTranslations('admin.database.backup');
  const [rows, setRows] = useState<BackupRow[]>(initialBackups);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null);

  function refresh(): void {
    void adminFetch<{ backups?: BackupRow[] }>('/api/admin/database/backup')
      .then((j) => {
        if (j.backups) setRows(j.backups);
      })
      .catch(() => undefined);
  }

  function onCreate(): void {
    setFeedback(null);
    startTransition(() => {
      void (async () => {
        try {
          const csrf = await fetchCsrfToken();
          const j = await adminFetch<{ filename: string; size: number }>(
            '/api/admin/database/backup',
            {
              method: 'POST',
              body: { csrf },
            },
          );
          setFeedback({
            kind: 'success',
            message: t('createSuccess', {
              filename: j.filename,
              size: formatBytes(j.size),
            }),
          });
          refresh();
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          setFeedback({
            kind: 'error',
            message: t('createFailed', {
              error: message.startsWith('adminFetch ') ? `HTTP ${message.split(' ')[1]?.split(':')[0] ?? ''}` : message,
            }),
          });
        }
      })();
    });
  }

  function onDelete(filename: string): void {
    if (!window.confirm(t('deleteConfirm', { filename }))) return;
    startTransition(() => {
      void (async () => {
        try {
          await adminFetch(
            `/api/admin/database/backup?id=${encodeURIComponent(filename)}`,
            { method: 'DELETE' },
          );
          refresh();
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          setFeedback({
            kind: 'error',
            message: t('createFailed', {
              error: message.startsWith('adminFetch ') ? `HTTP ${message.split(' ')[1]?.split(':')[0] ?? ''}` : message,
            }),
          });
        }
      })();
    });
  }

  return (
    <section className="ghc-admin-section">
      <h2 className="ghc-admin-section-title">{t('heading')}</h2>

      <div className="ghc-admin-actions-row">
        <button
          type="button"
          onClick={onCreate}
          disabled={isPending}
          className="ghc-btn ghc-btn-primary"
        >
          {isPending ? t('creating') : t('createButton')}
        </button>
      </div>

      {feedback ? (
        <div
          className={
            feedback.kind === 'success'
              ? 'ghc-admin-feedback ghc-admin-feedback-ok'
              : 'ghc-admin-feedback ghc-admin-feedback-err'
          }
        >
          {feedback.message}
        </div>
      ) : null}

      <p className="ghc-admin-hint">
        {t('retentionHint', { keep: keepN })}
      </p>

      <h3 className="ghc-admin-section-subtitle">{t('listHeader')}</h3>
      {rows.length === 0 ? (
        <p className="ghc-admin-empty">{t('listEmpty')}</p>
      ) : (
        <table className="ghc-admin-table">
          <thead>
            <tr>
              <th>{t('listHeader')}</th>
              <th>{t('size')}</th>
              <th>{t('mtime')}</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.filename}>
                <td>
                  <a
                    className="ghc-link"
                    href={`/api/admin/database/backup/${encodeURIComponent(r.filename)}/download`}
                  >
                    {r.filename}
                  </a>
                </td>
                <td>{formatBytes(r.size)}</td>
                <td>{formatDateTime(r.mtime, tz)}</td>
                <td className="ghc-admin-table-actions">
                  <a
                    className="ghc-btn ghc-btn-small"
                    href={`/api/admin/database/backup/${encodeURIComponent(r.filename)}/download`}
                  >
                    {t('downloadLabel')}
                  </a>
                  <button
                    type="button"
                    className="ghc-btn ghc-btn-small ghc-btn-danger"
                    onClick={() => onDelete(r.filename)}
                  >
                    {t('deleteLabel')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}