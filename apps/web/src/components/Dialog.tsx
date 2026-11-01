/** The one modal, standing on shadcn's.
 *
 * Eleven dialogs each carried the same fourteen lines: a fixed backdrop that closed on
 * a click that landed on itself, a focus trap, and an Escape binding — except that two
 * of them had lost the Escape binding under a comment saying it was "bound above", and
 * one bound it on `window` in the bubble phase, the exact bug `lib/useEscape.ts` exists
 * to end. A scaffold copied eleven times is a rule enforced nowhere.
 *
 * The scaffold is shadcn's Dialog now, which is Base UI's: a portal out of whatever
 * transformed, virtualised row opened it, a backdrop, a focus trap, the page behind hidden
 * from assistive tech, Escape and an exit it waits for. It lives in the overlay chunk
 * (`components/overlays/DialogImpl.tsx`) — Base UI's overlay code, about 42 KB gzipped,
 * which the first load does not carry — and this file is what the first load does carry:
 * the two names the callers already use, the dialog's place on the Escape stack from the
 * moment it opens, and how a body becomes a legacy island.
 *
 * Where the shell goes. Base UI draws a portal's contents a render or two after the portal
 * itself, and the component that renders `<Dialog>` runs its effects in between — which is
 * where every form here focuses its first field, and where CatchUpPanel asks for its
 * summary. So under `DialogPresence` the shell is mounted *above* that component and draws
 * it inside the popup: its effects run once its body is in the document, as they did when
 * the dialog was a native `<dialog>` rendered in place. A `Dialog` mounted the plain way,
 * `{open && <Dialog/>}`, has nobody above it to do that and makes a shell of its own; its
 * body arrives a render later, and focus goes to its first field the way Base UI puts it
 * there. The contents tell the shell what they are through `lib/dialogHost.ts`.
 *
 * The body is a legacy island. Callers pass markup written for the legacy CSS — `.dialog`,
 * `.dialog-title`, `.btn`, `.field` — which the preflight repair in `styles/app/base.css`
 * would otherwise not reach inside shadcn's `data-slot` popup. `data-legacy` is what tells
 * it to.
 *
 * Mounted on open, always: `{open && <Dialog/>}`, or `DialogPresence`, which mounts it at
 * the same moment and unmounts it later, once Base UI has played its exit.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { lazyOverlay } from './lazyOverlay.tsx';
import { DialogHostContext, useDialogHost, type DialogHost } from '../lib/dialogHost.ts';
import { useEscapeLayer, type EarlyAnswer } from '../lib/useEscape.ts';
import { FALLBACK_MS } from '../lib/usePresence.ts';

/** Base UI's root, portal, backdrop and popup, from the overlay chunk. */
const DialogShell = lazyOverlay((m) => m.DialogImpl);

interface DialogProps {
  /** What assistive tech calls the dialog. */
  label: string;
  /** A variant's host class — `lightbox-host`, `palette-host` — on the element that holds
   *  the backdrop and the panel, where its CSS sets the shell's custom properties. */
  className?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({ label, className, onClose, children }: DialogProps) {
  const host = useDialogHost();
  if (!host) {
    // Nothing above this to draw it: a shell of its own, open for as long as it is mounted.
    return (
      <DialogPresence when>
        {() => (
          <Dialog label={label} className={className} onClose={onClose}>
            {children}
          </Dialog>
        )}
      </DialogPresence>
    );
  }
  return (
    <Island host={host} label={label} className={className} onClose={onClose}>
      {children}
    </Island>
  );
}

/** The caller's body, inside the shell, styled as it always was. */
function Island({ host, label, className, onClose, children }: DialogProps & { host: DialogHost }) {
  useLayoutEffect(() => {
    host.register({ label, className }, onClose);
  }, [host, label, className, onClose]);

  return (
    // A dialog opened from inside this one gets a shell of its own, not this one.
    <DialogHostContext.Provider value={null}>
      <div data-legacy="">{children}</div>
    </DialogHostContext.Provider>
  );
}

/**
 * A dialog that leaves as well as arrives.
 *
 * `{open && <X/>}` is what fires a dialog's autofocus and — in CatchUpPanel — its request,
 * and rendering dialogs always so they could animate out would fire all of that at
 * start-up. This renders nothing until `when` is truthy, so every one of those still fires
 * when the dialog opens and never before. On close the dialog stays mounted for Base UI's
 * exit — `data-closed`, `inert`, off the Escape stack, focus already home — and goes when
 * Base UI says the exit is over (`onOpenChangeComplete`), or after `FALLBACK_MS` if it
 * never says: a chunk that failed to load has no exit to report.
 *
 * `when` is the thing the dialog is about, not only whether it is open: the message
 * being forwarded, the emoji being removed. The dialog is drawn from the last truthy one
 * for the length of its exit, because by then the caller has already set it to null and
 * a dialog re-rendered from null would empty itself while it faded.
 *
 * Reopened while it is still leaving, it mounts a new dialog rather than reviving the
 * old one. A dialog that has been answered once will not close again, and the new one's
 * focus and on-mount work should run exactly as a first opening's would.
 */
export function DialogPresence<T>({
  when,
  children,
}: {
  when: T | null | undefined | false;
  children: (value: T) => ReactNode;
}) {
  const open = Boolean(when);

  // Both adjusted during render, React's "adjusting state when a prop changes": an effect
  // would land a commit late, after a frame drawn from the value that was just cleared.
  const [held, setHeld] = useState(when);
  if (open && held !== when) setHeld(when);
  const [phase, setPhase] = useState({ open, count: 0, leaving: false });
  if (phase.open !== open) {
    setPhase({ open, count: open ? phase.count + 1 : phase.count, leaving: !open });
  }

  const finish = useCallback(() => {
    setPhase((current) => (current.leaving ? { ...current, leaving: false } : current));
  }, []);

  useEffect(() => {
    if (!phase.leaving) return undefined;
    const timer = window.setTimeout(finish, FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase.leaving, phase.count, finish]);

  if (!(open || phase.leaving) || !held) return null;
  return (
    <Opening key={phase.count} open={open} onExited={finish}>
      {children(held as T)}
    </Opening>
  );
}

/**
 * One opening of a dialog: its place on the Escape stack, and the shell round it.
 *
 * The place is taken here, in the first load, as the dialog opens — not by the shell, which
 * is the overlay chunk's and may still be on its way. A dialog asked for in the first
 * second after load is open before it is drawn, and an Escape pressed then is the dialog's
 * all the same: let through, it reached the shell's listener, which closed the thread
 * behind or marked the channel read. So until the shell says it is drawn the layer answers
 * the key itself — nothing beneath hears it — and the shell closes the dialog once the
 * chunk lands and the contents have said what closing means, since `onClose` is theirs and
 * only the chunk draws them. It is drawn for the length of its exit, the one sign of an
 * Escape that came early. From the moment it is drawn, Base UI's own listener answers and
 * the layer only holds the top. Either way it comes off the stack as soon as the dialog
 * has been answered or starts to leave, so the next Escape reaches whatever is underneath.
 */
function Opening({ open, onExited, children }: { open: boolean; onExited: () => void; children: ReactNode }) {
  const [escaped, setEscaped] = useState(false);
  const drawn = useRef(false);
  const onDrawn = useCallback(() => {
    drawn.current = true;
  }, []);
  // One object for the opening's whole life: a new one would re-register the layer on top.
  const [early] = useState<EarlyAnswer>(() => ({
    drawn: () => drawn.current,
    close: () => setEscaped(true),
  }));
  useEscapeLayer(open && !escaped, early);

  return (
    <DialogShell open={open} escaped={escaped} onDrawn={onDrawn} onExited={onExited}>
      {children}
    </DialogShell>
  );
}
