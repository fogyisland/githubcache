'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { setAdminModeAction, type SetAdminModeState } from '@/app/_actions/set-admin-mode';
import { ADMIN_MODES, ADMIN_MODE_IDS, type AdminModeId } from '@/lib/admin/mode';

const INITIAL: SetAdminModeState = { status: 'idle' };

function ModePill({
  mode,
  current,
  label,
  ariaLabel,
}: {
  mode: AdminModeId;
  current: AdminModeId;
  label: string;
  ariaLabel: string;
}): React.ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="adminMode"
      value={mode}
      className="ghc-mode-pill"
      disabled={pending}
      aria-pressed={mode === current}
      aria-label={ariaLabel}
      data-active={mode === current}
    >
      {label}
    </button>
  );
}

/**
 * M26.x — admin color mode switcher (light / dark).
 *
 * Mirror of AdminVariantSwitcher: two pill buttons that submit a
 * server action. Both modes are always visible so the operator can
 * flip in one click without first checking which is active.
 */
export function AdminModeSwitcher({ current }: { current: AdminModeId }): React.ReactElement {
  const t = useTranslations('adminMode');
  const [state, formAction] = useFormState(setAdminModeAction, INITIAL);

  return (
    <form
      action={formAction}
      className="ghc-mode-row"
      role="radiogroup"
      aria-label={t('aria')}
    >
      {ADMIN_MODE_IDS.map((m) => (
        <ModePill
          key={m}
          mode={m}
          current={current}
          label={t(`label.${m}`)}
          ariaLabel={t('switchTo', { name: ADMIN_MODES[m].label, mood: ADMIN_MODES[m].mood })}
        />
      ))}
      <span className="sr-only" data-admin-mode-state={state.status} data-current-mode={current}>
        {state.status === 'ok' ? t('status.ok', { mode: state.mode ?? '' }) : ''}
      </span>
    </form>
  );
}
