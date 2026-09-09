'use client';

import { useFormStatus } from 'react-dom';
import { useActionState } from 'react';;
import { useTranslations } from 'next-intl';
import { setAdminModeAction, type SetAdminModeState } from '@/app/_actions/set-admin-mode';
import { ADMIN_MODES, type AdminModeId } from '@/lib/admin/mode';

const INITIAL: SetAdminModeState = { status: 'idle' };

/**
 * M28.bug28 — admin color mode toggle (sun/moon icon).
 *
 * Single icon button in the top-right utility bar that flips between
 * light ("Daylight") and dark ("Nightfall"). The icon shows the
 * *destination* state — a moon icon means "click to go dark", a sun
 * icon means "click to go light" — matching the convention GitHub /
 * Linear / VS Code use.
 *
 * Replaces the prior dual-pill row (L / D) which was harder to spot
 * among the other utility controls and took up two pill widths.
 */
export function AdminModeSwitcher({ current }: { current: AdminModeId }): React.ReactElement {
  const t = useTranslations('adminMode');
  const [state, formAction] = useActionState(setAdminModeAction, INITIAL);
  const next: AdminModeId = current === 'light' ? 'dark' : 'light';
  const ariaLabel = t('toggleTo', {
    name: ADMIN_MODES[next].label,
    mood: ADMIN_MODES[next].mood,
  });

  return (
    <form action={formAction} className="ghc-mode-toggle-form">
      <input type="hidden" name="adminMode" value={next} />
      <SubmitButton ariaLabel={ariaLabel} icon={current === 'light' ? <MoonIcon /> : <SunIcon />} />
      <span className="sr-only" data-admin-mode-state={state.status} data-current-mode={current}>
        {state.status === 'ok' && state.mode ? t('switchedTo', { name: ADMIN_MODES[state.mode].label }) : ''}
      </span>
    </form>
  );
}

function SubmitButton({
  ariaLabel,
  icon,
}: {
  ariaLabel: string;
  icon: React.ReactElement;
}): React.ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="ghc-mode-toggle"
      disabled={pending}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {icon}
    </button>
  );
}

/** Sun icon — shown when current mode is dark (click to go light). */
function SunIcon(): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

/** Moon icon — shown when current mode is light (click to go dark). */
function MoonIcon(): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}