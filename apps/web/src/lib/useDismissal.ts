/** How a panel beside a trigger its caller owns is dismissed, and how long it stays drawn.
 *
 * Three menus grew three private copies of the same dismissal wiring, and no two got it
 * quite alike; a popover would have been the fourth. This is the house contract, once, for
 * `components/Menu.tsx` and `components/Popover.tsx` both: dismissed by a click *outside*
 * the panel — decided by `contains`, never "any click" — by Escape, or by focus moving out
 * of it, with all three suspended while the caller has a dialog up, because a dialog
 * rendered beside the panel is "outside" by that test and would be unmounted by the very
 * click that asked for it. See the ChannelMenu trap note in `.torsor/active/context.md`.
 * And focus goes back to whatever opened the panel when it closes, unless the person sent
 * it somewhere else.
 *
 * Escape goes through `lib/useEscape`, which owns one capture-phase listener and a stack,
 * so the key stops here instead of also reaching the shell.
 *
 * First-load code, and kept out of the overlay chunk on purpose: a panel opened before the
 * chunk lands already answers Escape and a click outside, and opens once the chunk is here.
 * The panel itself is Base UI's, with its own dismissal switched off or declined
 * (`components/overlays/MenuImpl.tsx`, `PopoverImpl.tsx`). That is scaffolding with an
 * exit: this goes when the callers move to Base UI's own triggers (phases 4 and 5).
 *
 * What a menu adds on top — its arrow keys — stays in `Menu`: a popover's contents are not
 * a list of items.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useEscape } from './useEscape.ts';
import { FALLBACK_MS } from './usePresence.ts';

export interface DismissalOptions {
  open: boolean;
  /** True while the caller has a dialog up: dismissing would unmount the dialog too. */
  suspended: boolean;
  onClose: () => void;
}

/**
 * Dismiss the panel drawn inside `panel` — the anchor it hangs in, so `contains` on it is
 * "inside the panel" — and send focus home when it closes.
 *
 * Returns what had focus as it opened: the trigger, wherever the browser left it. Focus goes
 * back there on close, and a menu's arrows step into the panel from there.
 */
export function useDismissal(
  panel: RefObject<HTMLElement | null>,
  { open, suspended, onClose }: DismissalOptions,
): RefObject<HTMLElement | null> {
  // Whatever held focus when the panel opened — the trigger, wherever the browser left it.
  // Focus goes back there on close so a keyboard user is not stranded on <body>.
  const openerRef = useRef<HTMLElement | null>(null);
  // True for the moment focus is being sent home, which is a close and not a reason for one.
  const goingHomeRef = useRef(false);
  // Set when focus moving out closed the panel: it is on its way somewhere the person sent
  // it — mid-move, so `document.activeElement` is still <body> — and is not brought back.
  const focusLeftRef = useRef(false);

  // A layout effect, so the opener is the trigger and not wherever the panel has taken
  // focus since; and so focus is home before a dialog that one of its items opened looks
  // for where to send focus back.
  useLayoutEffect(() => {
    if (!open) return undefined;
    openerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    focusLeftRef.current = false;
    const anchor = panel.current;
    return () => {
      // Restore only when closing left focus nowhere — on <body>, or in the panel that is
      // going. A click that closed the panel by landing on another control has given that
      // control focus, and keeps it.
      const active = document.activeElement;
      if (
        !focusLeftRef.current &&
        (active === null ||
          active === document.body ||
          (active instanceof Node && anchor?.contains(active)))
      ) {
        goingHomeRef.current = true;
        openerRef.current?.focus();
        goingHomeRef.current = false;
      }
      openerRef.current = null;
    };
  }, [open, panel]);

  // Escape through the shared stack rather than a listener of its own: two bubble
  // listeners on `window` both run, so a panel closing itself did not stop the shell
  // from also acting on the key — closing the thread behind it, or marking the channel
  // read. See `lib/useEscape`.
  useEscape(onClose, open && !suspended);

  useEffect(() => {
    if (!open || suspended) return undefined;
    // Capture phase, so a click that lands on another control closes this first
    // rather than leaving two panels open.
    const onClick = (event: globalThis.MouseEvent) => {
      if (!panel.current?.contains(event.target as Node)) onClose();
    };
    // And when focus moves out of it — Tab past its last control, Shift+Tab back to its
    // trigger — as a menu or a popover does everywhere else. Not for focus going nowhere
    // (the window losing focus, a click on something that takes none), which leaves it
    // open as a click inside would. An open panel with focus elsewhere was never much use,
    // and is now worse: Base UI takes the contents of a panel it has portalled out of the
    // tab order while focus is outside it, so Tab would no longer find them.
    const anchor = panel.current;
    const onFocusOut = (event: globalThis.FocusEvent) => {
      const next = event.relatedTarget;
      if (goingHomeRef.current || !(next instanceof Node) || anchor?.contains(next)) return;
      focusLeftRef.current = true;
      onClose();
    };
    // Back in, as when a caller kept it open: a close after this is an ordinary one again.
    const onFocusIn = () => {
      focusLeftRef.current = false;
    };
    window.addEventListener('click', onClick, true);
    anchor?.addEventListener('focusout', onFocusOut);
    anchor?.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('click', onClick, true);
      anchor?.removeEventListener('focusout', onFocusOut);
      anchor?.removeEventListener('focusin', onFocusIn);
    };
  }, [open, suspended, onClose, panel]);

  // Everything above keys on `open`, not on whether the panel is still drawn: a panel on
  // its way out must stop answering Escape the moment it is asked to close, or it would
  // still be dismissable while it faded.
  return openerRef;
}

/**
 * Whether the panel is drawn: while it is open and through its exit, and not otherwise. A
 * closed panel carries nothing of the overlay chunk, and a chunk that failed to load is
 * asked for again on the next opening (`lazyOverlay`).
 *
 * Returns that, and what to call once the exit has played — Base UI says so in
 * `onOpenChangeComplete`. Adjusted during render, React's "adjusting state when a prop
 * changes", so the panel goes in the same commit as the `open` that asked for it; and
 * `FALLBACK_MS` is the floor for an exit nobody reports, since a chunk that never arrived
 * has none to play.
 */
export function useHeldThroughExit(open: boolean): readonly [drawn: boolean, exited: () => void] {
  const [phase, setPhase] = useState({ open, leaving: false });
  if (phase.open !== open) setPhase({ open, leaving: !open });
  const exited = useCallback(() => {
    setPhase((current) => (current.leaving ? { ...current, leaving: false } : current));
  }, []);
  useEffect(() => {
    if (!phase.leaving) return undefined;
    const timer = window.setTimeout(exited, FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase.leaving, exited]);
  return [open || phase.leaving, exited] as const;
}
