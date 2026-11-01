/** The dropdown behind a trigger the caller renders.
 *
 * Three menus grew three private copies of the same dismissal wiring, and no two got
 * it quite alike. This is the house contract, once: dismissed by a click *outside*
 * the panel — decided by `contains`, never "any click" — by Escape, or by focus moving
 * out of it, with all three suspended while the caller has a dialog up, because a dialog
 * rendered beside the panel is "outside" by that test and would be unmounted by the very
 * click that asked for it. See the ChannelMenu trap note in `.torsor/active/context.md`.
 *
 * Escape goes through `lib/useEscape`, which owns one capture-phase listener and a stack,
 * so the key stops here instead of also reaching the shell.
 *
 * The trigger stays with the caller: what opens a menu is one-off (an avatar, a
 * workspace name, a channel title) and what closes one is not. The panel keeps the
 * caller's own class so each menu's existing CSS continues to key on its own name.
 *
 * The panel is drawn by Base UI's Menu, through shadcn's `DropdownMenu` root, in the
 * overlay chunk (`components/overlays/MenuImpl.tsx`): it places the panel, turns it over
 * and caps it where there is no room, plays its exit and moves focus to its first item. Only
 * that — the callers' items are their own buttons, not Base UI's, so its own keys and
 * dismissal are off. This file is what the first load carries — the contract above, and a
 * zero-size anchor where the panel used to sit, which the panel is drawn into and hangs
 * from. The contract lives here rather than in the chunk so it holds from the first click:
 * a menu opened before the chunk lands already answers Escape and a click outside, and
 * opens once the chunk is here.
 *
 * The contract, the anchor and the hidden focus guards below are scaffolding: they go when
 * the callers move to `DropdownMenuTrigger` and `DropdownMenuItem` (phases 4 and 5;
 * `MenuImpl.tsx` says which caller goes when).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { lazyOverlay } from './lazyOverlay.tsx';
import { useEscape } from '../lib/useEscape.ts';
import { FALLBACK_MS } from '../lib/usePresence.ts';

/** Base UI's root, portal, positioner and popup, from the overlay chunk. */
const MenuPanel = lazyOverlay((m) => m.MenuImpl);

/** Every focusable menu item, in DOM order. Disabled ones cannot take focus, so
 *  offering them to the arrows would strand the roving focus on the way past. */
const ITEM_SELECTOR =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Goes on the panel element itself, where each caller's CSS expects it. */
  className?: string;
  /** True while the caller has a dialog up: dismissing would unmount the dialog too. */
  suspendDismiss?: boolean;
  children: ReactNode;
}

export function Menu({
  open,
  onClose,
  className,
  suspendDismiss = false,
  children,
}: Props) {
  // Where the panel used to sit. It is drawn inside this — so `contains` on it is "inside
  // the panel" — and hangs from the box this is positioned in, the caller's own wrapper.
  const anchorRef = useRef<HTMLSpanElement>(null);
  // Whatever held focus when the menu opened — the trigger, wherever the browser left
  // it. Focus goes back there on close so a keyboard user is not stranded on <body>.
  const openerRef = useRef<HTMLElement | null>(null);
  // True for the moment focus is being sent home, which is a close and not a reason for one.
  const goingHomeRef = useRef(false);
  // Set when focus moving out closed the menu: it is on its way somewhere the person sent it
  // — mid-move, so `document.activeElement` is still <body> — and is not brought back.
  const focusLeftRef = useRef(false);

  // Mounted while open and through the exit, and not otherwise: a closed menu carries
  // nothing of the chunk, and a chunk that failed to load is asked for again on the next
  // opening (`lazyOverlay`). Adjusted during render, React's "adjusting state when a prop
  // changes", so the panel goes in the same commit as the `open` that asked for it.
  const [phase, setPhase] = useState({ open, leaving: false });
  if (phase.open !== open) setPhase({ open, leaving: !open });
  const exited = useCallback(() => {
    setPhase((current) => (current.leaving ? { ...current, leaving: false } : current));
  }, []);
  // The floor, for an exit nobody reports: a chunk that never arrived has none to play.
  useEffect(() => {
    if (!phase.leaving) return undefined;
    const timer = window.setTimeout(exited, FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [phase.leaving, exited]);

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
    const anchor = anchorRef.current;
    return () => {
      // Restore only when closing left focus nowhere — on <body>, or in the panel that is
      // going. A click that closed the menu by landing on another control has given that
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
  }, [open]);

  // Escape through the shared stack rather than a listener of its own: two bubble
  // listeners on `window` both run, so a menu closing itself did not stop the shell
  // from also acting on the key — closing the thread behind it, or marking the channel
  // read. See `lib/useEscape`.
  useEscape(onClose, open && !suspendDismiss);

  useEffect(() => {
    if (!open || suspendDismiss) return undefined;
    // Capture phase, so a click that lands on another control closes this first
    // rather than leaving two panels open.
    const onClick = (event: globalThis.MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) onClose();
    };
    // Capture phase too, so the keys arrive whatever the panel is drawn inside: a dialog
    // stops the arrow keys at its edge, and a menu opened in one would never hear them.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== 'ArrowDown' &&
        event.key !== 'ArrowUp' &&
        event.key !== 'Home' &&
        event.key !== 'End'
      ) {
        return;
      }
      const panel = anchorRef.current;
      if (!panel) return;
      const active = document.activeElement;
      const inPanel = active instanceof HTMLElement && panel.contains(active);
      // A form control inside the panel owns its own arrows: Up and Down change the
      // option of a <select> and step the segment of a date field. Steering focus to
      // the next menu item instead makes those controls unusable by keyboard, which is
      // exactly what the schedule menu's repeat select and time field would hit.
      if (
        inPanel &&
        (active instanceof HTMLSelectElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLInputElement)
      ) {
        return;
      }
      // Steer only focus the menu plausibly owns: inside the panel, on the element
      // that opened it, or nowhere (Safari does not focus a clicked button). Arrows
      // pressed in a composer behind an open menu keep moving the caret there.
      if (
        !inPanel &&
        active !== openerRef.current &&
        active !== document.body &&
        active !== null
      ) {
        return;
      }
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR),
      );
      if (items.length === 0) return;
      event.preventDefault();
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1;
      let next: number;
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = items.length - 1;
      else if (event.key === 'ArrowDown')
        next = index < 0 ? 0 : (index + 1) % items.length;
      else
        next =
          index < 0
            ? items.length - 1
            : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    // And when focus moves out of it — Tab past its last item, Shift+Tab back to its
    // trigger — as a menu does everywhere else. Not for focus going nowhere (the window
    // losing focus, a click on something that takes none), which leaves it open as a
    // click inside would. An open menu with focus elsewhere was never much use, and is
    // now worse: Base UI takes the items of a panel it has portalled out of the tab order
    // while focus is outside it, so Tab would no longer find them.
    const anchor = anchorRef.current;
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
    window.addEventListener('keydown', onKey, true);
    anchor?.addEventListener('focusout', onFocusOut);
    anchor?.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey, true);
      anchor?.removeEventListener('focusout', onFocusOut);
      anchor?.removeEventListener('focusin', onFocusIn);
    };
  }, [open, suspendDismiss, onClose]);

  // Every effect above keys on `open`, not on whether the panel is still drawn: a menu
  // on its way out must stop answering Escape and arrow keys the moment it is asked to
  // close, or it would still be steering focus while it faded.
  //
  // The anchor is out of the flow and the span round it has no box (`contents`), so neither
  // costs the caller's layout anything, and the anchor still hangs from the caller's own
  // wrapper. The panel comes after the anchor rather than inside it so the anchor is in the
  // document by the time Base UI looks for it to draw into.
  //
  // Everything Base UI draws for the menu lands inside the outer span, including the focus
  // guards it puts round a portal to carry Tab from a trigger to a panel drawn somewhere
  // else in the page. This panel is drawn here, so the page's own order already does that,
  // and the guards are taken out of it: left in, the one after the last item swallowed the
  // Tab that should have moved on, because it hands focus to a trigger of Base UI's own,
  // and these menus have none. The attribute is Base UI's, hardcoded in its
  // `utils/FocusGuard` and renamed once before; `Menu.test.tsx` fails if the class here
  // stops matching what Base UI draws.
  return (
    <span className="contents [&_[data-base-ui-focus-guard]]:hidden!">
      <span ref={anchorRef} className="absolute" />
      {(open || phase.leaving) && (
        <MenuPanel
          open={open}
          anchor={anchorRef}
          opener={openerRef}
          className={className}
          onExited={exited}
        >
          {children}
        </MenuPanel>
      )}
    </span>
  );
}
