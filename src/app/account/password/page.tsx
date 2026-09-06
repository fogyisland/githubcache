import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { ChangePasswordForm } from './_components/change-password-form';

/**
 * M26 — /account/password.
 *
 * Server component shell. Renders the client change-password form
 * and surfaces a success banner when `?changed=1` is on the URL
 * (the server action redirects here on success).
 */
export default async function AccountPasswordPage({
  searchParams,
}: {
  searchParams: { changed?: string };
}): Promise<ReactElement> {
  const t = await getTranslations('account.password');
  const showSuccess = searchParams.changed === '1';

  return (
    <div className="ghc-fade-up flex flex-col gap-6">
      <header>
        <h2 className="text-xl font-semibold">{t('title')}</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {t('subtitle')}
        </p>
      </header>

      {showSuccess && (
        <div role="status" className="ghc-alert-ok">
          {t('success')}
        </div>
      )}

      <div className="ghc-card p-6">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
