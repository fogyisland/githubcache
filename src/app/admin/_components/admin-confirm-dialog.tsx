'use client';

import { useFormStatus } from 'react-dom';
import { useId, useRef, type ReactElement, type ReactNode } from 'react';

interface Props {
  /** Text on the trigger button (e.g. "Delete", "Revoke"). */
  triggerLabel: ReactNode;
  /** Heading shown in the dialog. */
  title: string;
  /** Body copy explaining what the action does. */
  description: string;
  /** Label of the destructive submit button. */
  confirmLabel: string;
  /** Server action bound to the dialog's form. */
  action: (formData: FormData) => void | Promise<void>;
  /** Optional className for the trigger button. */
  triggerClassName?: string;
}

/**
 * Destructive-action confirmation dialog using native `<dialog>`.
 *
 * The trigger button is a `<button type="button" form="...">` that calls
 * `dialog.showModal()` via `onClick`. The dialog contains a form whose
 * `method="dialog"` submits to `action` (server action). Uses
 * `useFormStatus` to disable the confirm button while pending.
 *
 * This intentionally uses no third-party modal library — `<dialog>` is
 * well-supported in evergreen browsers and Next.js 14 already polyfills
 * nothing for it.
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
          action={action}
          method="dialog"
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
            <ConfirmButton label={confirmLabel} formId={formId} />
          </div>
        </form>
      </dialog>
    </>
  );
}

function ConfirmButton({ label, formId }: { label: string; formId: string }): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      form={formId}
      className="ghc-btn-danger"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? 'Working…' : label}
    </button>
  );
}