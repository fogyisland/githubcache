'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { setThemeAction, type SetThemeState } from '@/app/_actions/theme';
import { THEMES, type ThemeId } from '@/lib/theme/themes';

interface Props {
  current: ThemeId;
}

const INITIAL: SetThemeState = { status: 'idle' };

/**
 * One pill in the theme switcher. Reads `useFormStatus` so the active pill
 * shows a pending state while the server action runs.
 */
function PillButton({
  id,
  label,
  ariaLabel,
  active,
}: {
  id: ThemeId;
  label: string;
  ariaLabel: string;
  active: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="theme"
      value={id}
      className="ghc-theme-pill"
      disabled={pending}
      aria-pressed={active}
      aria-label={ariaLabel}
    >
      {label}
    </button>
  );
}

export function ThemeSwitcher({ current }: Props) {
  const t = useTranslations('theme');
  const [state, formAction] = useFormState(setThemeAction, INITIAL);

  return (
    <form action={formAction} className="ghc-theme-row" role="radiogroup" aria-label={t('aria')}>
      {Object.values(THEMES).map((th) => (
        <PillButton
          key={th.id}
          id={th.id}
          label={t(`label.${th.id}`)}
          ariaLabel={t('switchTo', { name: t(`fullLabel.${th.id}`) })}
          active={th.id === current}
        />
      ))}
      {/* Off-screen status mirror — surfaces form state for tests + a11y. */}
      <span className="sr-only" data-theme-state={state.status} data-current-theme={current}>
        {state.status === 'ok' ? `Theme is now ${state.theme}` : ''}
      </span>
    </form>
  );
}
