'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import { requestKeyAction, type RequestKeyState } from '@/app/account/keys/request/_actions/request';

const INITIAL: RequestKeyState = { status: 'idle' };

function SubmitBtn(): React.ReactElement {
  const t = useTranslations('account.keys.request');
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghc-btn-primary" disabled={pending}>
      {pending ? t('submitting') : t('submit')}
    </button>
  );
}

/**
 * M26 — request-key form (client).
 *
 * Two fields: name (required, ≤100 chars) + description (optional,
 * ≤500 chars). Server action validates + creates the ApiKey row
 * with status=pending and emails every admin via the key-requested
 * trigger.
 */
export function RequestKeyForm(): React.ReactElement {
  const t = useTranslations('account.keys.request');
  const [state, formAction] = useFormState(requestKeyAction, INITIAL);
  const f = state.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="key-name"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('nameLabel')}
        </label>
        <input
          id="key-name"
          name="name"
          type="text"
          required
          maxLength={100}
          placeholder={t('namePlaceholder')}
          className="ghc-input"
        />
        {f?.name && (
          <p role="alert" className="text-xs ghc-text-danger">
            {f.name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="key-description"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('descriptionLabel')}
        </label>
        <textarea
          id="key-description"
          name="description"
          rows={3}
          maxLength={500}
          placeholder={t('descriptionPlaceholder')}
          className="ghc-input"
        />
        {f?.description && (
          <p role="alert" className="text-xs ghc-text-danger">
            {f.description}
          </p>
        )}
      </div>

      {state.status === 'error' && state.message && (
        <div role="alert" className="ghc-alert-danger">
          {state.message}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <SubmitBtn />
        <a href="/account/keys" className="ghc-link" style={{ fontSize: '0.9rem' }}>
          {t('cancel')}
        </a>
      </div>
    </form>
  );
}
