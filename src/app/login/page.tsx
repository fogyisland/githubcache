import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from './_login-form';

/**
 * Admin login page.
 *
 * The root layout already reads the `ghc_theme` cookie and sets
 * `data-theme` on `<html>` before paint, so this page inherits the
 * active public theme (terminal / editorial / brutalist) via the
 * existing ghc-* classes — no theme-specific code here.
 *
 * The form is a client component because CSRF + submit are interactive.
 * Layout (brand, headline, tagline, card chrome) is server-rendered.
 */
export default async function LoginPage(): Promise<ReactElement> {
  const t = await getTranslations('login');
  return (
    <main className="mx-auto max-w-[26rem] py-16 px-4 ghc-fade-up">
      <header className="mb-8 text-center">
        <p
          className="font-mono text-xs tracking-[0.2em] uppercase"
          style={{ color: 'var(--color-accent)' }}
        >
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-2xl font-semibold">{t('title')}</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-ink-muted)' }}>
          {t('tagline')}
        </p>
      </header>

      <div className="ghc-card p-6">
        <LoginForm />
      </div>

      <p className="mt-6 text-center text-sm">
        <a href="/" className="ghc-link">
          {t('backToHome')}
        </a>
      </p>
    </main>
  );
}
