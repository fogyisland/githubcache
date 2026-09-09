'use client';

import { useFormStatus } from 'react-dom';
import { useActionState } from 'react';;
import {
  setAdminVariantAction,
  type SetAdminVariantState,
} from '@/app/_actions/admin-variant';
import { ADMIN_VARIANTS, type AdminVariantId } from '@/lib/admin/variant';

interface Props {
  current: AdminVariantId;
}

const INITIAL: SetAdminVariantState = { status: 'idle' };

/**
 * One pill in the admin variant switcher. Reads `useFormStatus` so the active
 * pill shows a pending state while the server action runs.
 */
function PillButton({
  id,
  label,
  active,
}: {
  id: AdminVariantId;
  label: string;
  active: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="adminVariant"
      value={id}
      className="ghc-admin-variant-pill"
      disabled={pending}
      aria-pressed={active}
      aria-label={`Switch to ${label} variant`}
      title={ADMIN_VARIANTS[id].mood}
    >
      {label}
    </button>
  );
}

export function AdminVariantSwitcher({ current }: Props) {
  const [state, formAction] = useActionState(setAdminVariantAction, INITIAL);

  return (
    <form
      action={formAction}
      className="ghc-admin-variant-row"
      role="radiogroup"
      aria-label="Admin variant"
    >
      {Object.values(ADMIN_VARIANTS).map((v) => (
        <PillButton key={v.id} id={v.id} label={v.shortLabel} active={v.id === current} />
      ))}
      {/* Off-screen status mirror — surfaces form state for tests + a11y. */}
      <span
        className="sr-only"
        data-admin-variant-state={state.status}
        data-current-admin-variant={current}
      >
        {state.status === 'ok' ? `Admin variant is now ${state.variant}` : ''}
      </span>
    </form>
  );
}