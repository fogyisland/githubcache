'use client';

import { useFormStatus } from 'react-dom';
import { useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from 'react';

interface Props {
  /** Text on the trigger button (e.g. "Delete", "Revoke"). */
  triggerLabel: ReactNode;
  /** Heading shown in the dialog. */
  title: string;
  /** Body copy explaining what the action does. */
  description: string;
  /** Label of the destructive submit button. */
  confirmLabel: string;
  /** Async action invoked when the user confirms. Receives the
   *  FormData so server actions and client closures share the same
   *  signature. */
  action: (formData: FormData) => void | Promise<void>;
  /** Optional className for the trigger button. */
  triggerClassName?: string;
}

/**
 * Destructive-action confirmation dialog using native `<dialog>`.
 *
 * Trigger button opens the dialog via `showModal()`. The dialog contains
 * a form whose `onSubmit` calls `action(formData)`. After the action
 * resolves we close the dialog ourselves — using `method="dialog"`
 * doesn't work with React 19's `<form action={fn}>` handling (React
 * warns: "Cannot specify a encType or method for a form that specifies
 * a function as the action") and using raw submit means the browser
 * would do a real navigation, which is exactly what we DON'T want.
 *
 * `useFormStatus` powers the disabled/aria-busy state on the confirm
 * button while the action is in flight.
 */
export function AdminConfirmDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  action,
  triggerClassName = 'ghc-btn-danger',
}: Props): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formId = useId();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    try {
      await action(new FormData(e.currentTarget));
      dialogRef.current?.close();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </button>
      <dialog ref={dialogRef} className="ghc-admin-confirm-dialog">
        <form
          id={formId}
          onSubmit={handleSubmit}
          className="ghc-admin-confirm-form"
        >
          <h3 className="ghc-admin-confirm-title">{title}</h3>
          <p className="ghc-admin-confirm-desc">{description}</p>
          <div className="ghc-admin-confirm-actions">
            <button
              type="button"
              className="ghc-btn-ghost"
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </button>
            <ConfirmButton label={confirmLabel} formId={formId} disabled={submitting} />
          </div>
        </form>
      </dialog>
    </>
  );
}

function ConfirmButton({
  label,
  formId,
  disabled,
}: {
  label: string;
  formId: string;
  disabled: boolean;
}): ReactElement {
  // useFormStatus covers the React-internal pending state for the form,
  // but we also need our local `submitting` flag to disable re-submits
  // while the action's await chain is in flight (useFormStatus only
  // toggles during a real form submission, which onSubmit+preventDefault
  // doesn't trigger).
  const { pending } = useFormStatus();
  const busy = pending || disabled;
  return (
    <button
      type="submit"
      form={formId}
      className="ghc-btn-danger"
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? 'Working…' : label}
    </button>
  );
}