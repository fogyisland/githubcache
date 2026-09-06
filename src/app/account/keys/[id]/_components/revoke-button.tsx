'use client';

import { useFormStatus } from 'react-dom';
import { useTranslations } from 'next-intl';
import type { ReactElement } from 'react';
import { revokeOwnKeyAction } from '@/app/account/keys/[id]/_actions/revoke';

interface Props {
  keyId: string;
}

function SubmitBtn({ label }: { label: string }): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="ghc-btn-danger"
      disabled={pending}
      style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
    >
      {pending ? '…' : label}
    </button>
  );
}

/**
 * M26 — small inline form that invokes `revokeOwnKeyAction`. The
 * server action handles all authorization + audit; this component
 * is just a form so the action gets called from a click without
 * any client-side JS state.
 */
export function RevokeOwnKeyButton({ keyId }: Props): ReactElement {
  const t = useTranslations('account.keys.detail.actions');
  return (
    <form action={revokeOwnKeyAction}>
      <input type="hidden" name="keyId" value={keyId} />
      <SubmitBtn label={t('revoke')} />
    </form>
  );
}
