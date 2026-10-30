/** Are you sure?
 *
 * The console used to ask with `window.confirm`, which is the one dialog in the app that
 * ignores the theme, cannot say what it is about to do in more than a sentence, and
 * names its buttons "OK" and "Cancel" no matter what is being destroyed. This is shadcn's
 * alert dialog with the confirm button labelled after the verb, so the last thing you
 * read before archiving a channel is "Archive".
 *
 * Deliberately without busy state: callers already funnel failures through
 * `useAdminAction`, so this closes as soon as it is answered and the page reports what
 * happened. One job, no lifecycle.
 *
 * The question itself is in the overlay chunk (`components/overlays/ConfirmDialogImpl.tsx`).
 * It is drawn inside the same dialog shell as every other dialog — under `DialogPresence`,
 * that is the presence's; mounted the plain way, one of its own — and registers as an
 * alert: `role="alertdialog"`, no closing on a click beside it, focus on the question.
 */

import { DialogPresence } from './Dialog.tsx';
import { lazyOverlay } from './lazyOverlay.tsx';
import { useDialogHost } from '../lib/dialogHost.ts';

export interface ConfirmDialogProps {
  title: string;
  body?: string;
  confirmLabel: string;
  /** Destructive answers get the danger colour rather than the accent. */
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

const ConfirmBody = lazyOverlay((m) => m.ConfirmDialogImpl);

export function ConfirmDialog(props: ConfirmDialogProps) {
  const host = useDialogHost();
  if (!host) {
    return <DialogPresence when>{() => <ConfirmDialog {...props} />}</DialogPresence>;
  }
  return <ConfirmBody {...props} />;
}
