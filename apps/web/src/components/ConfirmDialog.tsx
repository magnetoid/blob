/** Are you sure?
 *
 * The console used to ask with `window.confirm`, which is the one dialog in the app that
 * ignores the theme, cannot say what it is about to do in more than a sentence, and
 * names its buttons "OK" and "Cancel" no matter what is being destroyed. This is the
 * same markup as every other dialog here, with the confirm button labelled after the
 * verb, so the last thing you read before archiving a channel is "Archive".
 *
 * Deliberately without busy state: callers already funnel failures through
 * `useAdminAction`, so this closes as soon as it is answered and the page reports what
 * happened. One job, no lifecycle.
 */

import { useEffect, useRef } from "react";
import { trapFocus } from "../lib/focusTrap.ts";

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  body?: string;
  confirmLabel: string;
  /** Destructive answers get the danger colour rather than the accent. */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The dialog takes focus, not the confirm button. Focusing the button would make Return
  // destroy something, one keystroke after a dialog appeared under your hands — and the
  // point of asking is that the answer is deliberate.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // After the deliberate self-focus above, so the trap keeps rather than moves it.
  useEffect(() => trapFocus(dialogRef.current), []);

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (
          event.key === "Escape" ||
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();
          onClose();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Close ${title}`}
    >
      <div
        ref={dialogRef}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <h2 className="dialog-title">{title}</h2>
        {body && <p className="pref-hint">{body}</p>}

        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            type="button"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
