/** The one modal.
 *
 * Eleven dialogs each carried the same fourteen lines: a fixed backdrop that closed on
 * a click that landed on itself, a focus trap, and an Escape binding — except that two
 * of them had lost the Escape binding under a comment saying it was "bound above", and
 * one bound it on `window` in the bubble phase, the exact bug `lib/useEscape.ts` exists
 * to end. A scaffold copied eleven times is a rule enforced nowhere.
 *
 * Native `<dialog>` with `showModal()` does most of the job in the platform: the top
 * layer, so a dialog opened from inside a transformed, virtualised message row is not
 * trapped in that row's stacking context; `::backdrop`; and everything behind it inert,
 * which is the promise `aria-modal="true"` had been making and a hand-written Tab trap
 * only half kept. The top layer sits above toasts too, which is right — a toast is not
 * a reason to lose the question you were asked.
 *
 * Two things stay ours. Escape goes through the stack in `lib/useEscape.ts`, because a
 * dialog opened over a menu has to close the dialog and the native `cancel` event knows
 * nothing about menus; `cancel` is prevented so the element does not close itself out
 * from under React, which is what unmounts it. And focus goes back where it came from —
 * on unmount, because the platform restores it only on `close()`, which nothing else
 * calls; or, for a dialog leaving through `DialogPresence`, the moment it starts to leave
 * (`letGo`, below).
 *
 * Mounted on open, always — `{open && <Dialog/>}`, or `DialogPresence` below, which
 * mounts it at the same moment and only unmounts it later, once it has animated away.
 */

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useEscape } from '../lib/useEscape.ts';
import { usePresence, type PresenceState } from '../lib/usePresence.ts';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What a `DialogPresence` tells the one dialog inside it: whether it is leaving, and
 *  the ref its exit is watched through. Null for a dialog mounted the plain way. */
const Leaving = createContext<{
  state: PresenceState;
  ref: RefObject<HTMLDialogElement | null>;
} | null>(null);

/**
 * Stop being modal without leaving the screen.
 *
 * A modal dialog makes everything behind it inert, which is right while it is asking and
 * wrong for the 150ms it spends leaving: focus has nowhere to go back to, and a key or a
 * click in that window lands nowhere. Closing it gives the page back — and takes it out
 * of the top layer, which is the step the `overlay` property exists to delay and not
 * every browser has. So it is closed and put straight back in the top layer as a manual
 * popover, in the same task: no frame is drawn between the two, its backdrop comes back
 * with it, and nothing behind it is blocked any more. A manual popover has no light
 * dismiss and answers no Escape, so it only sits there, `inert`, until it has faded.
 * Which is also why the Escape that closed it has to be default-prevented, as
 * `useEscape` does: the browser's own close request comes after the key's handlers,
 * goes to whichever dialog is modal by then — no longer this one — and would close the
 * dialog underneath as well.
 *
 * Returns whether the page was given back. Where there are no popovers it was not, and
 * the dialog stays modal through its exit, as it did before this existed.
 */
function letGo(node: HTMLDialogElement): boolean {
  if (!node.open || typeof node.showPopover !== 'function') return false;
  // First, while it is still modal, which popover rules allow: the stylesheet keeps a
  // closing popover-to-be drawn, so the exit already under way is never cut by the
  // `display: none` a closed dialog has for the instant before it is shown again.
  node.setAttribute('popover', 'manual');
  node.close();
  try {
    node.showPopover();
  } catch {
    // Refused. It goes at once, as a dialog used to, rather than be drawn outside the top
    // layer — the attribute is what the stylesheet holds it on screen by.
    node.removeAttribute('popover');
  }
  return true;
}

export function Dialog({
  label,
  className,
  onClose,
  children,
}: {
  /** What assistive tech calls the dialog. */
  label: string;
  /** A variant's host class, for its own `::backdrop` and size — `lightbox-host`. */
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const own = useRef<HTMLDialogElement>(null);
  const presence = useContext(Leaving);
  const ref = presence?.ref ?? own;
  const leaving = presence?.state === 'closed';

  // The latest `onClose` without re-registering on the Escape stack each render. A
  // dialog that re-pushed itself on every render would climb back over a menu that had
  // been opened inside it, and Escape would close the wrong thing.
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  }, [onClose]);
  // A dialog closes once. Escape reaches it twice — through the stack, and again as the
  // platform's `cancel` — and a backdrop click followed by Escape must not ask twice.
  const closed = useRef(false);
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    latest.current();
  }, []);

  // A dialog on its way out has already been answered. Off the stack at once, the way a
  // leaving menu is, so the next Escape reaches whatever is underneath rather than a
  // dialog that can no longer close.
  useEscape(close, !leaving);

  // Where focus was when this opened, and whether it has been handed back yet. One per
  // opening: made by the effect that shows the dialog, marked by the one that lets it go,
  // so that the unmount after an exit does not hand focus back a second time.
  const opening = useRef<{ opener: HTMLElement | null; returned: boolean } | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const session = {
      opener: document.activeElement as HTMLElement | null,
      returned: false,
    };
    opening.current = session;
    if (!node.open) node.showModal();
    // The platform's focusing steps put focus on the first control inside — in browsers
    // that run them; not every host does, and a modal that leaves focus behind an inert
    // page is unreachable by keyboard. So it is checked, not assumed. A caller that wants
    // focus somewhere else does so in its own effect, which runs after this one.
    if (!node.contains(document.activeElement)) {
      (node.querySelector<HTMLElement>(FOCUSABLE) ?? node).focus();
    }
    return () => {
      if (node.open) node.close();
      // Already handed back as the exit began — and in the 150ms since, the person may
      // have clicked into the composer or onto a row, and must not be pulled back.
      if (!session.returned) session.opener?.focus?.();
    };
    // `ref` is this component's own or its presence's, and neither changes for the life
    // of the element: this runs once, on the mount that shows the dialog.
  }, [ref]);

  // Leaving: hand the page back now and keep only the picture for the exit. A layout
  // effect, so the swap in `letGo` is done before the frame that starts the exit.
  useLayoutEffect(() => {
    const node = ref.current;
    const session = opening.current;
    if (!leaving || !node || !session || session.returned) return;
    if (!letGo(node)) return;
    session.returned = true;
    // `close()` returns focus to the opener itself, in the browsers that follow the
    // spec's focusing steps; this is for the rest, and for an opener the platform lost.
    const opener = session.opener;
    if (opener?.isConnected && document.activeElement !== opener) opener.focus?.();
  }, [leaving, ref]);

  return (
    // The keyboard path is Escape, above; a click on the backdrop is the pointer shortcut
    // for it, and the element it lands on is this one.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Escape is the keyboard path
    <dialog
      ref={ref}
      className={className ? `dialog-host ${className}` : 'dialog-host'}
      aria-label={label}
      tabIndex={-1}
      // No longer modal while it leaves (`letGo`), but still drawn, over a page that is
      // live again — so `inert`: nothing in it can be clicked, focused or read out for
      // the length of the exit.
      data-state={presence?.state}
      inert={leaving ? true : undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        // A click on `::backdrop` is delivered to the element itself. The content wrapper
        // fills the element, so a click whose target is the element landed outside it.
        if (event.target === event.currentTarget) close();
      }}
    >
      {/* A dialog opened from inside this one answers to its own presence, not this. */}
      <Leaving.Provider value={null}>{children}</Leaving.Provider>
    </dialog>
  );
}

/**
 * A dialog that leaves as well as arrives.
 *
 * The dialogs used to be enter-only, because `{open && <X/>}` is what fires a dialog's
 * focus trap, its autofocus and — in CatchUpPanel — its request, and rendering them
 * always so they could animate out would have fired all of that at start-up. This
 * renders nothing until `when` is truthy, so every one of those still fires on the
 * render that opens the dialog and never before. What changes is only the other end: on
 * close the dialog stays mounted for one exit — `inert`, off the Escape stack,
 * `data-state="closed"` for the stylesheet — and is unmounted when its own animation
 * ends. It stops being modal as the exit begins (`letGo`), so focus goes back to
 * whatever opened it straight away and the page behind takes keys and clicks again while
 * the dialog fades over it.
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
  const ref = useRef<HTMLDialogElement>(null);
  const { present, state } = usePresence(open, ref);

  // Both adjusted during render, as `usePresence` adjusts its own: an effect would land a
  // commit late, after a frame drawn from the value that was just cleared.
  const [held, setHeld] = useState(when);
  if (open && held !== when) setHeld(when);
  const [opening, setOpening] = useState({ open, count: 0 });
  if (opening.open !== open) {
    setOpening({ open, count: open ? opening.count + 1 : opening.count });
  }

  if (!present || !held) return null;
  return (
    <Leaving.Provider value={{ state, ref }}>
      <Fragment key={opening.count}>{children(held as T)}</Fragment>
    </Leaving.Provider>
  );
}
