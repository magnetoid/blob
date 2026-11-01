/**
 * The question a `ConfirmDialog` asks, in shadcn's alert dialog.
 *
 * Drawn inside the dialog shell (`DialogImpl`), which it tells it is an alert: Base UI's
 * `AlertDialog.Root` is its `Dialog.Root` with exactly those three settings — modal, no
 * dismissal by a click beside it, `role="alertdialog"` — so one shell serves both, and a
 * confirm opened through `DialogPresence` is held through its exit like any other dialog.
 * The parts are the generated `alert-dialog.tsx`'s; the surface carries
 * `AlertDialogContent`'s look, which the shell's popup would otherwise have drawn along
 * with its position and motion.
 */

import { useLayoutEffect } from 'react';
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog.tsx';
import { useDialogHost } from '../../lib/dialogHost.ts';
import type { ConfirmDialogProps } from '../ConfirmDialog.tsx';

/** Under `pointer: coarse` every target is at least 44px, as everywhere else in the app. */
const TOUCH_TARGET = 'pointer-coarse:min-h-11';

export function ConfirmDialogImpl({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const host = useDialogHost();
  useLayoutEffect(() => {
    host?.register({ label: title, alert: true }, onClose);
  }, [host, title, onClose]);

  return (
    <div
      data-slot="alert-dialog-content"
      data-size="default"
      className="group/alert-dialog-content grid w-80 max-w-full gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 sm:w-96"
    >
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        {body && <AlertDialogDescription>{body}</AlertDialogDescription>}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel className={TOUCH_TARGET}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          variant={danger ? 'destructive' : 'default'}
          className={TOUCH_TARGET}
          onClick={onConfirm}
        >
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </div>
  );
}
