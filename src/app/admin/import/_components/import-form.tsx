'use client';

import { useState, useTransition, type ReactElement } from 'react';
import { useTranslations } from 'next-intl';
import { adminFetch } from '@/lib/api/admin-fetch';
import { fetchCsrfToken } from '@/lib/csrf/client';
import { IMPORTABLE_TABLES } from '@/lib/import/tables';

interface Props {
  // Optional in form-only render contexts (tests, isolated demos). When
  // omitted, falls back to the full whitelist so the table picker still
  // shows every candidate.
  importableTables?: string[];
}

type DryRunRow = {
  table: string;
  willInsert: number;
  willSkip: number;
  willFail: number;
  sampleRows: unknown[];
};

type TestConnectionResult =
  | { ok: true; databases: string[]; tables: string[] }
  | { ok: false; error: string };

type ApplyResult = {
  results: Array<{ table: string; inserted: number; skipped: number; failed: number }>;
  auditIds: Array<bigint | number>;
};

type Feedback =
  | { kind: 'success'; message: string }
  | { kind: 'error'; message: string }
  | null;

const CONFIRM_WORD = 'IMPORT';

/**
 * Cross-database import form (M32.7.7-b).
 *
 * Flow:
 *   1. User fills source connection (host/port/user/password/database)
 *   2. "Test connection" → server SELECT 1 + SHOW DATABASES + lists
 *      whitelisted tables that exist in the source's target db
 *   3. User checks tables + clicks "Dry-run" → server projects
 *      willInsert/willSkip/willFail + sample rows
 *   4. User types IMPORT + clicks "Apply" → server does createMany
 *      skipDuplicates + writes audit
 *
 * Password lives only in form state — never persisted, never logged.
 */
export function ImportForm({ importableTables = [...IMPORTABLE_TABLES] }: Props): ReactElement {
  const t = useTranslations('admin.import');

  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('3306');
  const [user, setUser] = useState('root');
  const [password, setPassword] = useState('');
  const [database, setDatabase] = useState('');

  const [connectionStatus, setConnectionStatus] = useState<TestConnectionResult | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [dryRunResults, setDryRunResults] = useState<DryRunRow[] | null>(null);
  const [confirm, setConfirm] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);

  const [isTesting, startTestTransition] = useTransition();
  const [isDryRunning, startDryRunTransition] = useTransition();
  const [isApplying, startApplyTransition] = useTransition();

  const canTest =
    !isTesting && host !== '' && port !== '' && user !== '' && database !== '';
  const canDryRun =
    !isDryRunning &&
    connectionStatus?.ok === true &&
    selectedTables.size > 0;
  const canApply =
    !isApplying &&
    connectionStatus?.ok === true &&
    selectedTables.size > 0 &&
    confirm === CONFIRM_WORD;

  function toggleTable(name: string): void {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function postJSON<T>(url: string, body: unknown): Promise<T> {
    const csrf = await fetchCsrfToken();
    return adminFetch<T>(url, {
      method: 'POST',
      body: { csrf, ...(body as Record<string, unknown>) },
    });
  }

  function onTestConnection(): void {
    setFeedback(null);
    setConnectionStatus(null);
    setDryRunResults(null);
    startTestTransition(() => {
      void (async () => {
        try {
          const r = await postJSON<TestConnectionResult>('/api/admin/import/test', {
            host,
            port: Number(port),
            user,
            password,
            database,
          });
          setConnectionStatus(r);
        } catch (e: unknown) {
          setConnectionStatus({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
    });
  }

  function onDryRun(): void {
    setFeedback(null);
    setDryRunResults(null);
    startDryRunTransition(() => {
      void (async () => {
        try {
          const r = await postJSON<{ results: DryRunRow[] }>(
            '/api/admin/import/dry-run',
            {
              host,
              port: Number(port),
              user,
              password,
              database,
              tables: [...selectedTables],
            },
          );
          setDryRunResults(r.results);
        } catch (e: unknown) {
          setFeedback({ kind: 'error', message: formatError(e) });
        }
      })();
    });
  }

  function onApply(): void {
    setFeedback(null);
    startApplyTransition(() => {
      void (async () => {
        try {
          const r = await postJSON<ApplyResult>('/api/admin/import/apply', {
            host,
            port: Number(port),
            user,
            password,
            database,
            tables: [...selectedTables],
            confirm,
          });
          const total = r.results.reduce((acc, x) => acc + x.inserted, 0);
          setFeedback({
            kind: 'success',
            message: t('applySuccess', {
              inserted: total,
              tables: r.results.length,
            }),
          });
        } catch (e: unknown) {
          setFeedback({ kind: 'error', message: formatError(e) });
        }
      })();
    });
  }

  return (
    <div className="ghc-import-form">
      <h2 className="ghc-admin-section-title">{t('sourceHeading')}</h2>

      <div className="ghc-admin-form-row">
        <label className="ghc-admin-label" htmlFor="ghc-import-host">{t('fields.host')}</label>
        <input
          id="ghc-import-host"
          name="host"
          type="text"
          className="ghc-api-settings-input" data-numeric
          value={host}
          onChange={(e) => setHost(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="ghc-admin-form-row">
        <label className="ghc-admin-label" htmlFor="ghc-import-port">{t('fields.port')}</label>
        <input
          id="ghc-import-port"
          name="port"
          type="number"
          className="ghc-api-settings-input" data-numeric
          value={port}
          min={1}
          max={65535}
          onChange={(e) => setPort(e.target.value)}
        />
      </div>

      <div className="ghc-admin-form-row">
        <label className="ghc-admin-label" htmlFor="ghc-import-user">{t('fields.user')}</label>
        <input
          id="ghc-import-user"
          name="user"
          type="text"
          className="ghc-api-settings-input" data-numeric
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="ghc-admin-form-row">
        <label className="ghc-admin-label" htmlFor="ghc-import-password">{t('fields.password')}</label>
        <input
          id="ghc-import-password"
          name="password"
          type="password"
          className="ghc-api-settings-input" data-numeric
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <p className="ghc-admin-hint">{t('passwordHint')}</p>
      </div>

      <div className="ghc-admin-form-row">
        <label className="ghc-admin-label" htmlFor="ghc-import-database">{t('fields.database')}</label>
        <input
          id="ghc-import-database"
          name="database"
          type="text"
          className="ghc-api-settings-input" data-numeric
          value={database}
          onChange={(e) => setDatabase(e.target.value)}
          autoComplete="off"
        />
      </div>

      <div className="ghc-admin-actions-row">
        <button
          type="button"
          onClick={onTestConnection}
          disabled={!canTest}
          className="ghc-btn ghc-btn-primary"
        >
          {isTesting ? t('testing') : t('testConnection')}
        </button>
        {connectionStatus !== null ? (
          <span
            className={
              connectionStatus.ok
                ? 'ghc-admin-feedback ghc-admin-feedback-ok'
                : 'ghc-admin-feedback ghc-admin-feedback-err'
            }
          >
            {connectionStatus.ok
              ? t('testOk', { tables: connectionStatus.tables.length })
              : t('testFailed', { error: connectionStatus.error })}
          </span>
        ) : null}
      </div>

      {connectionStatus?.ok === true ? (
        <>
          <h2 className="ghc-admin-section-title">{t('tablesHeading')}</h2>
          <ul className="ghc-import-tables">
            {importableTables
              .filter((name) => connectionStatus.tables.includes(name))
              .map((name) => (
                <li key={name}>
                  <label className="ghc-admin-checkbox">
                    <input
                      type="checkbox"
                      name="tables"
                      value={name}
                      checked={selectedTables.has(name)}
                      onChange={() => toggleTable(name)}
                    />
                    <span>
                      <code>{name}</code>
                    </span>
                  </label>
                </li>
              ))}
          </ul>

          <div className="ghc-admin-actions-row">
            <button
              type="button"
              onClick={onDryRun}
              disabled={!canDryRun}
              className="ghc-btn ghc-btn-primary"
            >
              {isDryRunning ? t('dryRunning') : t('dryRun')}
            </button>
          </div>

          {dryRunResults !== null ? (
            <div className="ghc-import-dryrun">
              <h3 className="ghc-admin-section-title">{t('resultsHeading')}</h3>
              <pre className="ghc-admin-pre">
                {JSON.stringify(dryRunResults, null, 2)}
              </pre>
            </div>
          ) : null}

          <div className="ghc-admin-form-row">
            <label className="ghc-admin-label" htmlFor="ghc-import-confirm">{t('confirmPrompt')}</label>
            <input
              id="ghc-import-confirm"
              name="confirm"
              type="text"
              className="ghc-api-settings-input" data-numeric
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
              onClick={onApply}
              disabled={!canApply}
              className="ghc-btn ghc-btn-danger"
            >
              {isApplying ? t('applying') : t('apply')}
            </button>
          </div>

          {feedback !== null ? (
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
        </>
      ) : null}
    </div>
  );
}

function formatError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // adminFetch prepends its own prefix — strip so the user sees the
  // actual error from the route.
  const stripped = raw.startsWith('adminFetch ')
    ? raw.split('adminFetch ')[1]?.split(':').slice(1).join(':').trim() ?? raw
    : raw;
  return stripped !== '' ? stripped : 'Unknown error';
}