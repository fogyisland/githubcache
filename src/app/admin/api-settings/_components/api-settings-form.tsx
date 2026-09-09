'use client';

import { useState, useTransition, type ReactElement } from 'react';
import { useFormState } from 'react-dom';
import { useTranslations } from 'next-intl';
import { saveApiSettings, type SaveApiSettingsState } from '../_actions/save-settings';
import type { TunableKey } from '@/lib/config/settings-store';

const INITIAL: SaveApiSettingsState = { status: 'idle' };

interface FormField {
  key: TunableKey;
  label: string;
  hint: string;
  unit?: string;
  min?: number;
  max?: number;
}

const GITHUB_FIELDS: FormField[] = [
  { key: 'SCHEDULER_TICK_MS', label: 'Scheduler tick', hint: 'How often the scheduler claims jobs and refreshes cache. Lower = more responsive but more DB load.', unit: 'ms', min: 1000, max: 600_000 },
  { key: 'SCHEDULER_BATCH_SIZE', label: 'Batch size per tick', hint: 'How many refresh jobs to claim per tick. Higher = faster catch-up after an outage.', min: 1, max: 100 },
  { key: 'NIGHTLY_SWEEP_INTERVAL_MS', label: 'Nightly sweep interval', hint: 'How often the scheduler re-queues every cached repo for refresh.', unit: 'ms', min: 3_600_000 },
  { key: 'SCHEDULER_CORE_SWEEP_HOURS', label: 'Core sweep cadence', hint: 'How often a repo is fully re-fetched (the expensive /repos call).', unit: 'hours', min: 1, max: 720 },
  { key: 'SCHEDULER_RELEASES_SWEEP_HOURS', label: 'Releases sweep cadence', hint: 'How often the releases list is refreshed.', unit: 'hours', min: 1, max: 720 },
  { key: 'SCHEDULER_BRANCHES_SWEEP_HOURS', label: 'Branches sweep cadence', hint: 'How often the branches list is refreshed.', unit: 'hours', min: 1, max: 720 },
  { key: 'TOKEN_AUTO_DISABLE_THRESHOLD', label: 'Token auto-disable threshold', hint: 'Consecutive 429s before a GitHub PAT is auto-disabled. Set to 0 to disable.', min: 0, max: 20 },
];

const API_FIELDS: FormField[] = [
  { key: 'PUBLIC_LOOKUP_RATE_PER_MIN', label: 'Per-IP rate (public lookup)', hint: 'Per-IP requests per minute against the unauthenticated / form path.', unit: 'req/min', min: 1, max: 10_000 },
  { key: 'PUBLIC_REPO_RATE_PER_HOUR', label: 'Per-key rate (API key)', hint: 'Per-key requests per hour against the authenticated /api/v1/* paths.', unit: 'req/hour', min: 1, max: 1_000_000 },
];

export function ApiSettingsForm({
  section,
  current,
}: {
  section: 'github' | 'api';
  current: Record<string, string>;
}): ReactElement {
  const t = useTranslations('admin.apiSettings');
  const fields = section === 'github' ? GITHUB_FIELDS : API_FIELDS;
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of fields) init[f.key] = current[f.key] ?? '';
    return init;
  });
  const [state, formAction] = useFormState(saveApiSettings, INITIAL);
  const [pending, startTransition] = useTransition();

  function onChange(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  return (
    <form
      action={(fd) => startTransition(() => formAction(fd))}
      className="ghc-api-settings-form"
    >
      <input
        type="hidden"
        name="payload"
        value={JSON.stringify({
          updates: fields.map((f) => ({ key: f.key, value: Number(values[f.key]) })),
        })}
      />

      {fields.map((f) => (
        <div key={f.key} className="ghc-api-settings-field">
          <label htmlFor={`api-setting-${f.key}`} className="ghc-api-settings-label">
            {t(`fields.${f.key}.label`, { defaultValue: f.label })}
          </label>
          <div className="ghc-api-settings-input-row">
            <input
              id={`api-setting-${f.key}`}
              type="number"
              inputMode="numeric"
              min={f.min}
              max={f.max}
              step="1"
              value={values[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
              className="ghc-api-settings-input"
              autoComplete="off"
              spellCheck={false}
            />
            {f.unit ? <span className="ghc-api-settings-unit">{f.unit}</span> : null}
          </div>
          <p className="ghc-api-settings-hint">
            {t(`fields.${f.key}.hint`, { defaultValue: f.hint })}
          </p>
        </div>
      ))}

      <div className="ghc-api-settings-actions">
        <button
          type="submit"
          className="ghc-btn-primary"
          disabled={pending}
        >
          {pending ? t('saving') : t('save')}
        </button>
        {state.status === 'ok' && (
          <span className="ghc-api-settings-toast" role="status">
            {t('saved', { count: state.applied ?? 0 })}
            {state.needsRestart ? ' · ' + t('needsRestart') : ''}
          </span>
        )}
        {state.status === 'error' && (
          <span className="ghc-api-settings-toast ghc-api-settings-toast-error" role="alert">
            {t('saveFailed', { error: state.message ?? '' })}
          </span>
        )}
      </div>
    </form>
  );
}