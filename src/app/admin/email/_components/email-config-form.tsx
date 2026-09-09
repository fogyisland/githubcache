'use client';

import { useState, type ReactElement } from 'react';
import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import {
  saveEmailConfigAction,
  type SaveEmailConfigState,
} from '@/app/admin/email/_actions/save-config';

interface Props {
  initial: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpFrom: string;
    replyTo: string | null;
    smtpSecure: boolean;
    hasPassword: boolean;
  };
  csrfToken: string;
}

const initialState: SaveEmailConfigState = { status: 'idle' };

/**
 * M25 → M28 — SMTP config form (client component).
 *
 * Two visual sections (Server / Identity) inside one form so a
 * single submit persists all 7 fields atomically. Each field has
 * a helper text below it explaining the typical value (per Web
 * Interface Guidelines — placeholder-only labels are an
 * anti-pattern).
 *
 * Password is `type=password` with a show toggle. Leaving it
 * blank on update preserves the existing value (placeholder
 * reads "(unchanged)" / "（未更改）").
 */
export function EmailConfigForm({ initial, csrfToken }: Props): ReactElement {
  const t = useTranslations('admin.email.form');
  const [state, formAction, pending] = useActionState(saveEmailConfigAction, initialState);
  const [showPass, setShowPass] = useState(false);
  const [secure, setSecure] = useState<boolean>(initial.smtpSecure);

  return (
    <form action={formAction} className="ghc-email-form">
      <input type="hidden" name="csrf" value={csrfToken} />

      <section className="ghc-email-form-section">
        <h3 className="ghc-email-form-section-title">{t('serverHeading')}</h3>

        <Field id="smtp_host" label={t('host')} help={t('hostHelp')}>
          <input
            id="smtp_host"
            name="smtp_host"
            type="text"
            defaultValue={initial.smtpHost}
            required
            autoComplete="off"
            spellCheck={false}
            className="ghc-api-settings-input"
            placeholder={t('hostPlaceholder')}
          />
        </Field>

        <Field id="smtp_port" label={t('port')} help={t('portHelp')}>
          <input
            id="smtp_port"
            name="smtp_port"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            defaultValue={initial.smtpPort}
            required
            className="ghc-api-settings-input"
            autoComplete="off"
          />
        </Field>

        <Field id="smtp_user" label={t('user')} help={t('userHelp')}>
          <input
            id="smtp_user"
            name="smtp_user"
            type="text"
            defaultValue={initial.smtpUser}
            required
            autoComplete="off"
            spellCheck={false}
            className="ghc-api-settings-input"
          />
        </Field>

        <Field id="smtp_pass" label={t('pass')} help={t('passHelp')}>
          <div className="ghc-api-settings-input-row">
            <input
              id="smtp_pass"
              name="smtp_pass"
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              className="ghc-api-settings-input"
              placeholder={initial.hasPassword ? '(unchanged)' : ''}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShowPass((s) => !s)}
              className="ghc-btn-ghost ghc-btn-sm"
              aria-label={showPass ? t('passHide') : t('passShow')}
            >
              {showPass ? t('passHide') : t('passShow')}
            </button>
          </div>
        </Field>

        <Field id="smtp_secure" label={t('secure')} help={t('secureHelp')}>
          <label className="ghc-email-toggle">
            <input
              id="smtp_secure"
              name="smtp_secure"
              type="checkbox"
              value="on"
              checked={secure}
              onChange={(e) => setSecure(e.target.checked)}
            />
            <span className="ghc-email-toggle-track" aria-hidden="true">
              <span className="ghc-email-toggle-thumb" />
            </span>
            <span className="ghc-email-toggle-label">{t('secure')}</span>
          </label>
        </Field>
      </section>

      <section className="ghc-email-form-section">
        <h3 className="ghc-email-form-section-title">{t('identityHeading')}</h3>

        <Field id="smtp_from" label={t('from')} help={t('fromHelp')}>
          <input
            id="smtp_from"
            name="smtp_from"
            type="email"
            defaultValue={initial.smtpFrom}
            required
            className="ghc-api-settings-input"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('fromPlaceholder')}
          />
        </Field>

        <Field id="reply_to" label={t('replyTo')} help={t('replyToHelp')}>
          <input
            id="reply_to"
            name="reply_to"
            type="email"
            defaultValue={initial.replyTo ?? ''}
            className="ghc-api-settings-input"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('replyToPlaceholder')}
          />
        </Field>
      </section>

      <div className="ghc-api-settings-actions">
        <button type="submit" className="ghc-btn-primary" disabled={pending}>
          {pending ? t('saving') : t('save')}
        </button>
        {state.status === 'ok' ? (
          <span className="ghc-api-settings-toast" role="status">
            {t('savedOk')}
          </span>
        ) : null}
        {state.status === 'invalid' || state.status === 'error' || state.status === 'forbidden' ? (
          <span className="ghc-api-settings-toast ghc-api-settings-toast-error" role="alert">
            {t('failedWithError', { error: state.message ?? 'forbidden' })}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  help,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <div className="ghc-email-form-field">
      <label htmlFor={id} className="ghc-api-settings-label">
        {label}
      </label>
      {children}
      {help ? <p className="ghc-api-settings-hint">{help}</p> : null}
    </div>
  );
}