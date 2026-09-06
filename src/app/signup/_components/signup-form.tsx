'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { signupAction, type SignupState } from '@/app/signup/_actions/signup';

const INITIAL: SignupState = { status: 'idle' };

interface FieldErrors {
  email?: string;
  password?: string;
  passwordConfirm?: string;
  name?: string;
}

interface FormErrorsProps {
  fieldErrors: FieldErrors | undefined;
  status: SignupState['status'];
  generalMessage: string | null;
  tErr: (k: string) => string;
}

/**
 * Inline render of field-level + general form errors. Maps server
 * state into localized strings; falls back to generic on unknown
 * statuses.
 */
function FormErrors({ fieldErrors, status, generalMessage, tErr }: FormErrorsProps): React.ReactElement | null {
  if (status === 'duplicate') {
    return (
      <div role="alert" className="ghc-alert-danger">
        {tErr('duplicate')}
      </div>
    );
  }
  if (status === 'rate_limited') {
    return (
      <div role="alert" className="ghc-alert-danger">
        {tErr('rateLimited')}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="alert" className="ghc-alert-danger">
        {generalMessage ?? tErr('generic')}
      </div>
    );
  }
  if (!fieldErrors) return null;
  const firstError =
    fieldErrors.email ?? fieldErrors.password ?? fieldErrors.passwordConfirm ?? fieldErrors.name;
  if (!firstError) return null;
  return (
    <div role="alert" className="ghc-alert-danger">
      {firstError}
    </div>
  );
}

function SubmitBtn(): React.ReactElement {
  const t = useTranslations('signup');
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghc-btn-primary" disabled={pending}>
      {pending ? t('submitting') : t('submit')}
    </button>
  );
}

/**
 * Public signup form.
 *
 * Mirrors `src/app/login/_login-form.tsx` in shape (useFormState +
 * field-level errors), but submits via a server action rather than
 * fetch + CSRF — server actions get CSRF protection from Next.js
 * (the framework stamps its own token), so we don't need to fetch
 * the ghc_csrf cookie ourselves here.
 */
export function SignupForm(): React.ReactElement {
  const t = useTranslations('signup');
  const tErr = useTranslations('signup.error');
  const [state, formAction] = useFormState(signupAction, INITIAL);
  const f = state.fieldErrors;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-email" className="text-xs font-medium tracking-wide uppercase">
          {t('email.label')}
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder={t('email.placeholder')}
          className="ghc-input"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-password" className="text-xs font-medium tracking-wide uppercase">
          {t('password.label')}
        </label>
        <input
          id="signup-password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          className="ghc-input"
          aria-describedby="signup-password-help"
        />
        <p id="signup-password-help" className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          {t('password.help')}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="signup-password-confirm"
          className="text-xs font-medium tracking-wide uppercase"
        >
          {t('passwordConfirm.label')}
        </label>
        <input
          id="signup-password-confirm"
          name="passwordConfirm"
          type="password"
          required
          autoComplete="new-password"
          className="ghc-input"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="signup-name" className="text-xs font-medium tracking-wide uppercase">
          {t('name.label')}
        </label>
        <input
          id="signup-name"
          name="name"
          type="text"
          maxLength={100}
          placeholder={t('name.placeholder')}
          className="ghc-input"
          aria-describedby="signup-name-help"
        />
        <p id="signup-name-help" className="text-xs" style={{ color: 'var(--color-ink-muted)' }}>
          {t('name.help')}
        </p>
      </div>

      <FormErrors
        fieldErrors={f}
        status={state.status}
        generalMessage={state.message ?? null}
        tErr={(k) => tErr(k as 'duplicate' | 'rateLimited' | 'generic')}
      />

      <SubmitBtn />

      <p className="mt-2 text-center text-sm" style={{ color: 'var(--color-ink-muted)' }}>
        <Link href="/login" className="ghc-link">
          {t('haveAccount')}
        </Link>
      </p>
    </form>
  );
}
