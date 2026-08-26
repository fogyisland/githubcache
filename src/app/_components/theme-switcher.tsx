'use client';

import { useFormState, useFormStatus } from 'react-dom';
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
  active,
}: {
  id: ThemeId;
  label: string;
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
      aria-label={`Switch to ${label} theme`}
    >
      {label}
    </button>
  );
}

export function ThemeSwitcher({ current }: Props) {
  const [state, formAction] = useFormState(setThemeAction, INITIAL);

  return (
    <form action={formAction} className="ghc-theme-row" role="radiogroup" aria-label="Theme">
      {Object.values(THEMES).map((t) => (
        <PillButton key={t.id} id={t.id} label={t.shortLabel} active={t.id === current} />
      ))}
      {/* Off-screen status mirror — surfaces form state for tests + a11y. */}
      <span className="sr-only" data-theme-state={state.status} data-current-theme={current}>
        {state.status === 'ok' ? `Theme is now ${state.theme}` : ''}
      </span>
    </form>
  );
}