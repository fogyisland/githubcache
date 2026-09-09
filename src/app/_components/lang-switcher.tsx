'use client';

import { useFormStatus } from 'react-dom';
import { useActionState } from 'react';;
import { useTranslations } from 'next-intl';
import { setLangAction, type SetLangState } from '@/app/_actions/set-lang';
import type { Locale } from '@/i18n/config';

interface LangSwitcherProps {
  current: Locale;
  locales: readonly Locale[];
}

const INITIAL: SetLangState = { status: 'idle' };

function LangButton({
  locale,
  label,
  ariaLabel,
  active,
}: {
  locale: Locale;
  label: string;
  ariaLabel: string;
  active: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="locale"
      value={locale}
      className="ghc-lang-btn"
      disabled={pending}
      aria-pressed={active}
      aria-label={ariaLabel}
      data-active={active}
    >
      {label}
    </button>
  );
}

/**
 * Two-button language toggle. Mirrors `theme-switcher.tsx`.
 *
 * Uses `useActionState` for the server action wrapper, and `useFormStatus`
 * for per-button pending state. The sr-only status mirror surfaces
 * action state for tests + a11y.
 */
export function LangSwitcher({ current, locales }: LangSwitcherProps): React.ReactElement {
  const t = useTranslations('lang');
  const [state, formAction] = useActionState(setLangAction, INITIAL);
  return (
    <form action={formAction} className="ghc-lang-row" role="radiogroup" aria-label={t('aria')}>
      {locales.map((l) => (
        <LangButton
          key={l}
          locale={l}
          label={t(`label.${l}`)}
          ariaLabel={t('switchTo', { name: t(`fullLabel.${l}`) })}
          active={l === current}
        />
      ))}
      <span className="sr-only" data-lang-state={state.status} data-current-lang={current}>
        {state.status === 'ok' ? t('status.ok', { locale: state.locale ?? '' }) : ''}
      </span>
    </form>
  );
}
