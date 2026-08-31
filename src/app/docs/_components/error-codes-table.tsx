import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { ERROR_CODES, ERROR_CODE_STATUS, type ErrorCode } from '@/lib/api/errors';

interface RetryHint {
  /** When set, the row shows "after {seconds}s" (typically for 429). */
  retryAfter?: number;
  /** If true and no retryAfter, the row shows "later" (transient errors). */
  retryLater?: boolean;
  /** If true, the row shows "no". Default for permanent client errors. */
  retryNo?: boolean;
}

const RETRY_HINTS: Record<ErrorCode, RetryHint> = {
  bad_request: { retryNo: true },
  unauthorized: { retryNo: true },
  forbidden: { retryNo: true },
  not_found: { retryNo: true },
  conflict: { retryNo: true },
  payload_too_large: { retryNo: true },
  rate_limited: { retryAfter: 60 }, // representative; actual value comes from Retry-After header
  internal_error: { retryLater: true },
  unavailable: { retryLater: true },
};

/**
 * M15 — global "Error codes" table for /docs landing. Shows every
 * ErrorCode in the unified envelope with its HTTP status, retry
 * guidance, and one-line description. Distinct from the per-endpoint
 * `ErrorsTable` (which lists errors for one route).
 */
export async function ErrorCodesTable(): Promise<ReactElement> {
  const t = await getTranslations('docs.landing.errorCodes');
  return (
    <section className="ghc-doc-section">
      <h2 className="ghc-doc-h2">{t('heading')}</h2>
      <p>{t('intro')}</p>
      <table className="ghc-doc-table">
        <thead>
          <tr>
            <th>{t('columns.code')}</th>
            <th>{t('columns.status')}</th>
            <th>{t('columns.retry')}</th>
            <th>{t('columns.description')}</th>
          </tr>
        </thead>
        <tbody>
          {ERROR_CODES.map((code) => {
            const hint = RETRY_HINTS[code];
            const retryText = hint.retryAfter !== undefined
              ? t('retry.after', { seconds: hint.retryAfter })
              : hint.retryLater
                ? t('retry.later')
                : t('retry.no');
            return (
              <tr key={code}>
                <td><code className="ghc-admin-mono">{code}</code></td>
                <td><code>{ERROR_CODE_STATUS[code]}</code></td>
                <td>{retryText}</td>
                <td>{t(`codes.${code}`)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}