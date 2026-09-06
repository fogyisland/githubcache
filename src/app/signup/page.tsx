import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { validateSession } from '@/lib/auth/session';
import { SignupForm } from './_components/signup-form';

/**
 * Public /signup page (M26).
 *
 * If the visitor is already signed in, redirect to /account — there's
 * no reason for a logged-in user to see the signup form. Otherwise
 * render the same chrome the login page uses: eyebrow + headline +
 * tagline + card + back link.
 */
export default async function SignupPage(): Promise<ReactElement> {
  const cookieStore = cookies();
  const cookieMap = Object.fromEntries(cookieStore.getAll().map((c) => [c.name, c.value]));
  const user = await validateSession({
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        cookieMap[name] !== undefined ? { value: cookieMap[name]! } : undefined,
    },
  });
  if (user) {
    redirect('/account');
  }

  const t = await getTranslations('signup');

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
          {t('subtitle')}
        </p>
      </header>

      <div className="ghc-card p-6">
        <SignupForm />
      </div>

      <p className="mt-6 text-center text-sm">
        <a href="/" className="ghc-link">
          {t('backToHome')}
        </a>
      </p>
    </main>
  );
}
