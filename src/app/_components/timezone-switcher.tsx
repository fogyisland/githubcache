'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { setTimezoneAction, type SetTimezoneState } from '@/app/_actions/set-timezone';
import { TIMEZONE_IDS, TIMEZONES, type TimezoneId } from '@/lib/timezone/registry';

interface Props {
  current: TimezoneId;
}

const INITIAL: SetTimezoneState = { status: 'idle' };

/**
 * Dropdown selector for the per-user timezone preference.
 *
 * Auto-submits on `<select>` change via `form.requestSubmit()` — no separate
 * "Apply" button. Mirrors the lang / theme / adminVariant switchers in
 * being a single server-action form; differs in using a `<select>` because
 * the curated 17-entry list is too wide for a pill row.
 */
export function TimezoneSwitcher({ current }: Props): React.ReactElement {
  const t = useTranslations('timezone');
  const [state, formAction] = useActionState(setTimezoneAction, INITIAL);
  return (
    <form action={formAction} className="ghc-tz-form" aria-label={t('aria')}>
      <label className="sr-only" htmlFor="ghc-tz-select">{t('aria')}</label>
      <select
        id="ghc-tz-select"
        name="timezone"
        defaultValue={current}
        onChange={(e) => (e.currentTarget.form as HTMLFormElement).requestSubmit()}
        className="ghc-tz-select"
      >
        {TIMEZONE_IDS.map((id) => (
          <option key={id} value={id}>
            {t(`option.${id}`)}
          </option>
        ))}
      </select>
      <span className="sr-only" data-tz-state={state.status} data-current-tz={current}>
        {state.status === 'ok' ? t('status.ok', { tz: state.timezone ?? '' }) : ''}
      </span>
    </form>
  );
}

// Re-export for callers that want to enumerate the option metadata (tests).
export { TIMEZONES };
