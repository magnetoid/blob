/**
 * Transient notices, mostly failures.
 *
 * Exists for the actions that outlive their UI: a message menu closes the moment
 * "Pin" is clicked, so when the request behind it fails there is no form left to own
 * an inline error. Before this, those failures were silent — the pin just didn't
 * happen, and the person learned it later or never.
 */

import { create } from 'zustand';

export type ToastKind = 'error' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, text: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** How long a toast stays. Long enough to read twice, short enough not to nag. */
const TOAST_MS = 6000;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, text) => {
    const id = nextId++;
    set((s) => {
      // The same failure repeating (a dead network, a retried action) collapses into
      // one notice rather than a growing stack of identical ones.
      if (s.toasts.some((t) => t.text === text)) return s;
      return { toasts: [...s.toasts, { id, kind, text }] };
    });
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, TOAST_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * The catch-all for fire-and-forget actions: `void api.messages.pin(...).catch(showError)`.
 * Shows the server's own sentence when there is one, because the API writes its errors
 * for people.
 */
export function showError(err: unknown): void {
  const text =
    err instanceof Error && err.message ? err.message : 'That didn’t work. Try again.';
  useToasts.getState().push('error', text);
}
