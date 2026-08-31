'use client';

import type { ReactElement } from 'react';
import { useTranslations } from 'next-intl';

interface Props {
  mysqldumpAvailable: boolean;
  gzipAvailable: boolean;
  mysqldumpError?: string | undefined;
  gzipError?: string | undefined;
}

/**
 * M17 — Yellow banner surfaced on /admin/database when mysqldump or
 * gzip is missing on PATH. The buttons on the page stay visible but
 * disabled; the installHint points the operator at platform packages.
 */
export function BinaryWarning({
  mysqldumpAvailable,
  gzipAvailable,
  mysqldumpError,
  gzipError,
}: Props): ReactElement {
  const t = useTranslations('admin.database.binaryWarning');
  if (mysqldumpAvailable && gzipAvailable) return <></>;
  return (
    <div className="ghc-admin-warn-banner" role="alert">
      <strong>{t('heading')}</strong>
      <ul>
        {!mysqldumpAvailable ? (
          <li>
            {t('mysqldump')}
            {mysqldumpError ? <code className="ghc-code-inline"> — {mysqldumpError}</code> : null}
          </li>
        ) : null}
        {!gzipAvailable ? (
          <li>
            {t('gzip')}
            {gzipError ? <code className="ghc-code-inline"> — {gzipError}</code> : null}
          </li>
        ) : null}
      </ul>
      <p>{t('hint')}</p>
      <p>
        <code className="ghc-code-inline">{t('installHint')}</code>
      </p>
    </div>
  );
}
