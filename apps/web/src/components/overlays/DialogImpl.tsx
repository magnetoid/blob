/**
 * The dialog shell: shadcn's Dialog, which is Base UI's, around whatever is being asked.
 *
 * Base UI does what the native `<dialog>` used to: a portal out of whatever transformed,
 * virtualised row opened it, a backdrop, a focus trap, the page behind hidden from
 * assistive tech, and an exit it waits for before it unmounts. Four things stay Blob's.
 *
 * What the dialog is. The shell is mounted above the component that renders `<Dialog>` —
 * see `lib/dialogHost.ts` for why — so it starts with nothing to go on, and the contents
 * register their name, their variant's host class, what closing means and whether they are
 * an alert. That happens in a layout effect, so the frame that is painted is never one
 * without them.
 *
 * Closing once. Escape, a click on the backdrop and a Close button all reach
 * `onOpenChange`; the first is passed on and the rest are not, because a dialog that has
 * been answered has been answered.
 *
 * The shared Escape stack. Base UI's own listener closes the dialog — that is what plays
 * its exit and lets a dialog nested in it close first — but a panel or a legacy menu open
 * before it is on `lib/useEscape`'s stack and would otherwise be innermost. So the dialog
 * holds the top of that stack while it is open and lets the key through
 * (`useEscapeLayer`), and comes off it the moment it starts to leave, so the next Escape
 * reaches whatever is underneath.
 *
 * Focus going home. Base UI hands focus back when the exit has finished; Blob hands it
 * back as the exit begins, so a key pressed in those 150ms lands on the page rather than in
 * a dialog that is going. And only if it is still lost in the dialog: somebody who clicked
 * into the composer meanwhile keeps it there. Where it goes is wherever focus was when the
 * shell mounted — before the contents, which may well take focus as they mount.
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Dialog, DialogPortal } from '../ui/dialog.tsx';
import { DialogHostContext, type DialogConfig, type DialogHost } from '../../lib/dialogHost.ts';
import { useEscapeLayer } from '../../lib/useEscape.ts';

/**
 * Over the page at the modal's step on Blob's stacking ladder. The colour is the host's to
 * change (`--dialog-backdrop`, the lightbox's darker one), and it fades in and out on the
 * legacy keyframes and tokens the native backdrop used.
 */
const BACKDROP = [
  'fixed inset-0 z-(--z-modal) bg-[var(--dialog-backdrop,var(--backdrop))]',
  'animate-[fade-in_var(--dialog-enter,var(--dur-open))_var(--blob-ease-out)]',
  'data-ending-style:pointer-events-none',
  'data-ending-style:animate-[fade-out_var(--dur-exit)_var(--blob-ease-in)_forwards]',
].join(' ');

/**
 * Placed as the platform placed a modal `<dialog>` — fixed, fit to what it holds, centred
 * by auto margins, kept a gutter clear of the viewport's edges — so the panels drawn inside
 * it sit where they sat. A host moves it with custom properties: `--dialog-top` (the
 * palette sits high), `--dialog-gutter` (the lightbox's picture gets more of the screen),
 * `--dialog-enter` (the palette does not animate). The motion is the legacy `overlay-in`
 * and `overlay-out`, which travel and scale only by `--motion-slide` and
 * `--motion-scale-in`, so under reduced motion it fades and does not move.
 */
const POPUP = [
  'fixed inset-0 z-(--z-modal) mx-auto mt-[var(--dialog-top,auto)] mb-auto size-fit',
  'max-h-[calc(100dvh-var(--dialog-gutter,32px))] max-w-[calc(100vw-var(--dialog-gutter,32px))]',
  'outline-none',
  'animate-[overlay-in_var(--dialog-enter,var(--dur-modal))_var(--blob-ease-out)]',
  'data-ending-style:pointer-events-none',
  'data-ending-style:animate-[overlay-out_var(--dur-exit)_var(--blob-ease-in)_forwards]',
].join(' ');

/** Hand focus back to what opened the dialog, if it is still lost in the dialog or nowhere. */
function giveFocusBack(opener: HTMLElement | null, popup: RefObject<HTMLElement | null>): void {
  if (!opener?.isConnected) return;
  const active = document.activeElement;
  const lost =
    active === null || active === document.body || (popup.current?.contains(active) ?? false);
  if (lost && active !== opener) opener.focus();
}

export interface DialogImplProps {
  /** False while it leaves: Base UI plays the exit, then `onExited` is called. */
  open: boolean;
  onExited?: (() => void) | undefined;
  children: ReactNode;
}

export function DialogImpl({ open, onExited, children }: DialogImplProps) {
  const [config, setConfig] = useState<DialogConfig | null>(null);
  const onClose = useRef<(() => void) | null>(null);
  const answered = useRef(false);
  const popup = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  const [host] = useState<DialogHost>(() => ({
    register(next, close) {
      onClose.current = close;
      setConfig((current) =>
        current &&
        current.label === next.label &&
        current.className === next.className &&
        Boolean(current.alert) === Boolean(next.alert)
          ? current
          : next,
      );
    },
  }));

  const close = useCallback(() => {
    if (answered.current) return;
    answered.current = true;
    onClose.current?.();
  }, []);

  // Where focus was as the shell mounted, before the contents could take it; and on an
  // unmount while open — `{open && <Dialog/>}` closing — straight back there.
  useLayoutEffect(() => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    return () => giveFocusBack(opener.current, popup);
  }, []);

  // Leaving: home now, not in 150ms.
  useLayoutEffect(() => {
    if (!open) giveFocusBack(opener.current, popup);
  }, [open]);

  useEscapeLayer(open);

  const alert = Boolean(config?.alert);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onExited?.();
      }}
      disablePointerDismissal={alert}
    >
      <DialogPortal className={config?.className}>
        {/* Drawn for a nested dialog too, which Base UI leaves without one by default:
            each dialog here has always dimmed what is under it. */}
        <DialogPrimitive.Backdrop forceRender data-slot="dialog-overlay" className={BACKDROP} />
        <DialogPrimitive.Popup
          ref={popup}
          data-slot="dialog-content"
          aria-label={config?.label}
          {...(alert ? { role: 'alertdialog' } : {})}
          // An alert takes focus itself: focusing its answer would make Return destroy
          // something one keystroke after the question appeared.
          initialFocus={alert ? popup : undefined}
          // Handed back by `giveFocusBack`, as the exit begins.
          finalFocus={false}
          // Still drawn while it leaves, and nothing in it can be clicked, focused or read.
          inert={!open}
          className={POPUP}
        >
          <DialogHostContext.Provider value={host}>{children}</DialogHostContext.Provider>
        </DialogPrimitive.Popup>
      </DialogPortal>
    </Dialog>
  );
}
