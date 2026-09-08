'use client';

import { useState } from 'react';
import { useFormState } from 'react-dom';
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
 * M25 — SMTP config form (client component).
 *
 * Password field is type=password by default with a "show" toggle. On
 * update the placeholder reads "(unchanged)" — leaving it blank
 * preserves the existing value. The server action validates and
 * re-validates with zod; UI shows the translated result.
 */
export function EmailConfigForm({ initial, csrfToken }: Props): React.ReactElement {
  const t = useTranslations('admin.email.form');
  const [state, formAction, pending] = useFormState(saveEmailConfigAction, initialState);
  const [showPass, setShowPass] = useState(false);
  const [secure, setSecure] = useState<boolean>(initial.smtpSecure);

  return (
    <form action={formAction} className="ghc-admin-form">
      <input type="hidden" name="csrf" value={csrfToken} />

      <div className="ghc-admin-form-row">
        <label htmlFor="smtp_host" className="ghc-admin-form-label">
          {t('host')}
        </label>
        <input
          id="smtp_host"
          name="smtp_host"
          type="text"
          defaultValue={initial.smtpHost}
          required
          className="ghc-admin-input"
          placeholder={t('hostPlaceholder')}
        />
      </div>

      <div className="ghc-admin-form-row">
        <label htmlFor="smtp_port" className="ghc-admin-form-label">
          {t('port')}
        </label>
        <input
          id="smtp_port"
          name="smtp_port"
          type="number"
          min={1}
          max={65535}
          defaultValue={initial.smtpPort}
          required
          className="ghc-admin-input"
        />
      </div>

      <div className="ghc-admin-form-row">
        <label htmlFor="smtp_user" className="ghc-admin-form-label">
          {t('user')}
        </label>
        <input
          id="smtp_user"
          name="smtp_user"
          type="text"
          defaultValue={initial.smtpUser}
          required
          autoComplete="off"
          className="ghc-admin-input"
        />
      </div>

      <div className="ghc-admin-form-row">
        <label htmlFor="smtp_pass" className="ghc-admin-form-label">
          {t('pass')}
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="smtp_pass"
            name="smtp_pass"
            type={showPass ? 'text' : 'password'}
            autoComplete="new-password"
            className="ghc-admin-input"
            placeholder={initial.hasPassword ? '(unchanged)' : ''}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => setShowPass((s) => !s)}
            className="ghc-btn-ghost"
          >
            {showPass ? t('passHide') : t('passShow')}
          </button>
        </div>
      </div>

      <div className="ghc-admin-form-row">
        <label htmlFor="smtp_secure" className="ghc-admin-form-label">
          {t('secure')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            id="smtp_secure"
            name="smtp_secure"
            type="checkbox"
            value="on"
            checked={secure}
            onChange={(e) => setSecure(e.target.checked)}
          />
          <span>{t('secureHelp')}</span>
        </label>
      </div>

      <div className="ghc-admin-form-row">
        <label htmlFor="smtp_from" className="ghc-admin-form-label">
          {t('from')}
        </label>
        <input
          id="smtp_from"
          name="smtp_from"
          type="email"
          defaultValue={initial.smtpFrom}
          required
          className="ghc-admin-input"
          placeholder={t('fromPlaceholder')}
        />
      </div>

      <div className="ghc-admin-form-row">
        <label htmlFor="reply_to" className="ghc-admin-form-label">
          {t('replyTo')}
        </label>
        <input
          id="reply_to"
          name="reply_to"
          type="email"
          defaultValue={initial.replyTo ?? ''}
          className="ghc-admin-input"
          placeholder={t('replyToPlaceholder')}
        />
      </div>

      <div className="ghc-admin-form-actions">
        <button type="submit" disabled={pending} className="ghc-btn-primary">
          {pending ? t('saving') : t('save')}
        </button>
      </div>

      {state.status === 'ok' ? (
        <p className="ghc-admin-form-status ghc-admin-form-status-ok">{t('savedOk')}</p>
      ) : null}
      {state.status === 'invalid' || state.status === 'error' ? (
        <p className="ghc-admin-form-status ghc-admin-form-status-error">
          {t('failedWithError', { error: state.message ?? '' })}
        </p>
      ) : null}
      {state.status === 'forbidden' ? (
        <p className="ghc-admin-form-status ghc-admin-form-status-error">
          {state.message ?? 'forbidden'}
        </p>
      ) : null}
    </form>
  );
}
