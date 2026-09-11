import type { ReactElement } from 'react';
import { getTranslations } from 'next-intl/server';
import { LookupForm } from './lookup-form';
import { QuickTry } from './quick-try';

/**
 * Hero section: eyebrow + h1 + tagline + centered lookup form + quick-try row.
 * Pure server component (form is client — lookup is via server action).
 */
export async function HeroSection(): Promise<ReactElement> {
  const t = await getTranslations('home');
  return (
    <section className="ghc-hero">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:py-20">
        <div className="ghc-eyebrow mb-4 inline-flex items-center gap-2 px-3 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          {t('hero.eyebrow')}
        </div>
        <h1 className="ghc-display-heading">{t('hero.title')}</h1>
        <p className="ghc-hero-tagline">{t('hero.tagline')}</p>
        <div className="mx-auto mt-8 max-w-[640px]">
          <LookupForm />
        </div>
        <div className="mt-6">
          <QuickTry />
        </div>
      </div>
    </section>
  );
}