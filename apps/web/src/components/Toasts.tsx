/** The stack of transient notices. Rendered once, near the root. */

import { useToasts } from "../lib/toasts.ts";

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  // The region stays mounted even with nothing in it, and that is the whole point: a
  // live region has to exist *before* its content changes for the change to be
  // announced. Returning null until the first toast created the region and its text in
  // the same commit, which screen readers commonly say nothing about — so the one
  // channel the app uses to report a failure was the one a reader could not hear. The
  // stack is `position: fixed` and `pointer-events: none`, so an empty one costs no
  // layout and catches no clicks.
  return (
    // `status`+polite: announced by screen readers without stealing focus, which is
    // the right weight for "that didn't work" — an alert would interrupt typing.
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-text">{toast.text}</span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss notice"
            onClick={() => dismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
