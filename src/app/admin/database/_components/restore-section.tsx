'use client';

import { useState, useTransition, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';

interface BackupRow {
  filename: string;
  size: number;
  mtime: string;
}

interface Props {
  backups: BackupRow[];
}

const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/**
 * M17 — Restore UI. Two sub-forms:
 *   - "Restore from existing backup" — pick from list, confirm RESTORE
 *   - "Restore from uploaded .sql.gz" — file input + confirm RESTORE
 *
 * Both submit to /api/admin/database/restore. The button is disabled
 * until the user types "RESTORE" exactly. Result feedback (success
 * / failure) is shown below the form.
 */
export function RestoreSection({ backups }: Props): ReactElement {
  const t = useTranslations('admin.database.restore');
  const [mode, setMode] = useState<'backup' | 'upload'>('backup');
  const [filename, setFilename] = useState<string>(backups[0]?.filename ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [confirm, setConfirm] = useState<string>('');
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    | { kind: 'success'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null);

  async function getCsrf(): Promise<string> {
    const r = await fetch('/api/admin/auth/csrf', { credentials: 'include' });
    const j = (await r.json()) as { csrf?: string };
    if (!j.csrf) throw new Error('csrf init failed');
    return j.csrf;
  }

  const canSubmit =
    confirm === 'RESTORE' &&
    !isPending &&
    ((mode === 'backup' && filename !== '') ||
      (mode === 'upload' && file !== null && file.size > 0 && file.size <= MAX_UPLOAD_BYTES));

  function onSubmit(): void {
    setFeedback(null);
    startTransition(() => {
      void (async () => {
        try {
          const csrf = await getCsrf();
          let res: Response;
          if (mode === 'backup') {
            res = await fetch('/api/admin/database/restore', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ csrf, mode: 'backup', filename, confirm }),
            });
          } else {
            if (!file) throw new Error('file missing');
            const fd = new FormData();
            fd.set('csrf', csrf);
            fd.set('mode', 'upload');
            fd.set('confirm', confirm);
            fd.set('file', file);
            res = await fetch('/api/admin/database/restore', {
              method: 'POST',
              credentials: 'include',
              body: fd,
            });
          }
          const j = (await res.json().catch(() => ({}))) as {
            preRestoreBackup?: string;
            tableCount?: number;
            message?: string;
          };
          if (!res.ok) {
            setFeedback({
              kind: 'error',
              message: t('resultFailed', {
                error: j.message ?? `HTTP ${res.status}`,
              }),
            });
            return;
          }
          setFeedback({
            kind: 'success',
            message: t('resultSuccess', {
              tables: j.tableCount ?? 0,
              filename: j.preRestoreBackup ?? '?',
            }),
          });
        } catch (e: unknown) {
          setFeedback({
            kind: 'error',
            message: t('resultFailed', {
              error: e instanceof Error ? e.message : String(e),
            }),
          });
        }
      })();
    });
  }

  return (
    <section className="ghc-admin-section">
      <h2 className="ghc-admin-section-title">{t('heading')}</h2>

      <p className="ghc-admin-warn-inline">{t('warning')}</p>

      <div className="ghc-admin-restore-modes">
        <label className="ghc-admin-radio">
          <input
            type="radio"
            name="restore-mode"
            value="backup"
            checked={mode === 'backup'}
            onChange={() => setMode('backup')}
          />
          <span>{t('fromBackup')}</span>
        </label>
        <label className="ghc-admin-radio">
          <input
            type="radio"
            name="restore-mode"
            value="upload"
            checked={mode === 'upload'}
            onChange={() => setMode('upload')}
          />
          <span>{t('fromUpload')}</span>
        </label>
      </div>

      {mode === 'backup' ? (
        backups.length === 0 ? (
          <p className="ghc-admin-empty">{t('selectBackup')}</p>
        ) : (
          <select
            className="ghc-admin-select"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          >
            <option value="">{t('selectBackup')}</option>
            {backups.map((b) => (
              <option key={b.filename} value={b.filename}>
                {b.filename}
              </option>
            ))}
          </select>
        )
      ) : (
        <div className="ghc-admin-form-row">
          <label className="ghc-admin-label">{t('uploadLabel')}</label>
          <input
            type="file"
            accept=".gz,application/gzip"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="ghc-admin-hint">
            {t('uploadHelp', { max: `${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB` })}
          </p>
        </div>
      )}

      <div className="ghc-admin-form-row">
        <label className="ghc-admin-label">{t('confirmPrompt')}</label>
        <input
          type="text"
          className="ghc-admin-input ghc-admin-input-mono"
          placeholder={t('confirmPlaceholder')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="ghc-admin-actions-row">
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit}
          className="ghc-btn ghc-btn-danger"
        >
          {isPending ? t('submitting') : t('submitButton')}
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
    </section>
  );
}
