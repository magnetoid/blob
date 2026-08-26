/** The stack of transient notices. Rendered once, near the root. */

import { useToasts } from '../lib/toasts.ts';

export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  if (toasts.length === 0) return null;
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
