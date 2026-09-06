import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { RequestKeyForm } from './_components/request-key-form';

/**
 * M26 — /account/keys/request.
 *
 * Server component shell that pulls the i18n strings and renders
 * the client-side RequestKeyForm. Layout already validates session.
 */
export default async function RequestKeyPage(): Promise<ReactElement> {
  const t = await getTranslations('account.keys.request');

  return (
    <div className="ghc-fade-up flex flex-col gap-6 max-w-xl">
      <header>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {t('body')}
        </p>
      </header>

      <div className="ghc-card p-6">
        <RequestKeyForm />
      </div>
    </div>
  );
}
