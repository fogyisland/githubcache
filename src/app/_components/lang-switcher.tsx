'use client';

import { useFormState, useFormStatus } from 'react-dom';
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
  active,
}: {
  locale: Locale;
  label: string;
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
      aria-label={`Switch language to ${label}`}
      data-active={active}
    >
      {label}
    </button>
  );
}

/**
 * Two-button language toggle. Mirrors `theme-switcher.tsx`.
 *
 * Uses `useFormState` for the server action wrapper, and `useFormStatus`
 * for per-button pending state. The sr-only status mirror surfaces
 * action state for tests + a11y.
 */
export function LangSwitcher({ current, locales }: LangSwitcherProps): React.ReactElement {
  const t = useTranslations('lang');
  const [state, formAction] = useFormState(setLangAction, INITIAL);
  return (
    <form action={formAction} className="ghc-lang-row" role="radiogroup" aria-label={t('aria')}>
      {locales.map((l) => (
        <LangButton key={l} locale={l} label={t(`label.${l}`)} active={l === current} />
      ))}
      <span className="sr-only" data-lang-state={state.status} data-current-lang={current}>
        {state.status === 'ok' ? `Language is now ${state.locale}` : ''}
      </span>
    </form>
  );
}
