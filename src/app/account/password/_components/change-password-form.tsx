'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import {
  changePasswordAction,
  type ChangePasswordState,
} from '@/app/account/password/_actions/change-password';

const INITIAL: ChangePasswordState = { status: 'idle' };

function SubmitBtn(): React.ReactElement {
  const t = useTranslations('account.password');
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghc-btn-primary" disabled={pending}>
      {pending ? t('submitting') : t('submit')}
    </button>
  );
}

/**
 * M26 — change-password form (client). Three fields: current, new,
 * confirm. Server action validates and (on success) redirects to
 * /account/password?changed=1.
 */
export function ChangePasswordForm(): React.ReactElement {
  const t = useTranslations('account.password');
  const [state, formAction] = useFormState(changePasswordAction, INITIAL);
  const f = state.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-4 max-w-md">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="current-pw"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('currentLabel')}
        </label>
        <input
          id="current-pw"
          name="currentPassword"
          type="password"
          required
          autoComplete="current-password"
          className="ghc-input"
        />
        {f?.current && (
          <p role="alert" className="text-xs ghc-text-danger">
            {f.current}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="next-pw"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('nextLabel')}
        </label>
        <input
          id="next-pw"
          name="nextPassword"
          type="password"
          required
          autoComplete="new-password"
          className="ghc-input"
        />
        {f?.next && (
          <p role="alert" className="text-xs ghc-text-danger">
            {f.next}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirm-pw"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('confirmLabel')}
        </label>
        <input
          id="confirm-pw"
          name="confirmPassword"
          type="password"
          required
          autoComplete="new-password"
          className="ghc-input"
        />
        {f?.confirm && (
          <p role="alert" className="text-xs ghc-text-danger">
            {f.confirm}
          </p>
        )}
      </div>

      {state.status === 'error' && state.message && (
        <div role="alert" className="ghc-alert-danger">
          {state.message}
        </div>
      )}

      <SubmitBtn />
    </form>
  );
}
