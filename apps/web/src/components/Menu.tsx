/** The dropdown behind a trigger the caller renders.
 *
 * Dismissed the house way — a click outside the panel by `contains`, Escape through the
 * shared stack, focus moving out of it, all suspended while the caller has a dialog up,
 * and focus home to the trigger on close. That contract is `lib/useDismissal.ts`, shared
 * with `Popover` rather than copied: three menus once grew three copies of it and no two
 * got it quite alike. What is a menu's own is below: the arrow keys, which walk its items.
 *
 * The trigger stays with the caller: what opens a menu is one-off (an avatar, a
 * workspace name, a channel title) and what closes one is not. The panel keeps the
 * caller's own class so each menu's existing CSS continues to key on its own name.
 *
 * The panel is drawn by Base UI's Menu, through shadcn's `DropdownMenu` root, in the
 * overlay chunk (`components/overlays/MenuImpl.tsx`): it places the panel, turns it over
 * and caps it where there is no room, plays its exit and moves focus to its first item. Only
 * that — the callers' items are their own buttons, not Base UI's, so its own keys and
 * dismissal are off. This file is what the first load carries — the contract, the arrows,
 * and a zero-size anchor where the panel used to sit, which the panel is drawn into and
 * hangs from (`PanelAnchor`). The contract lives here rather than in the chunk so it holds
 * from the first click: a menu opened before the chunk lands already answers Escape and a
 * click outside, and opens once the chunk is here.
 *
 * The contract, the arrows, the anchor and the hidden focus guards are scaffolding: they go
 * when the callers move to `DropdownMenuTrigger` and `DropdownMenuItem` (phases 4 and 5;
 * `MenuImpl.tsx` says which caller goes when).
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { lazyOverlay } from './lazyOverlay.tsx';
import { MENU_ITEM } from './menuItems.ts';
import { PanelAnchor } from './PanelAnchor.tsx';
import { useDismissal } from '../lib/useDismissal.ts';
import { useHeldThroughExit } from '../lib/useHeldThroughExit.ts';

/** Base UI's root, portal, positioner and popup, from the overlay chunk. */
const MenuPanel = lazyOverlay((m) => m.MenuImpl);

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
  const opener = useDismissal(anchorRef, { open, suspended: suspendDismiss, onClose });
  const [drawn, exited] = useHeldThroughExit(open);

  // Keyed on `open`, not on whether the panel is still drawn: a menu on its way out must
  // stop steering focus the moment it is asked to close.
  useEffect(() => {
    if (!open || suspendDismiss) return undefined;
    // Capture phase, so the keys arrive whatever the panel is drawn inside: a dialog
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
        active !== opener.current &&
        active !== document.body &&
        active !== null
      ) {
        return;
      }
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(MENU_ITEM),
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
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, suspendDismiss, opener]);

  return (
    <PanelAnchor anchor={anchorRef}>
      {drawn && (
        <MenuPanel
          open={open}
          anchor={anchorRef}
          opener={opener}
          className={className}
          onExited={exited}
        >
          {children}
        </MenuPanel>
      )}
    </PanelAnchor>
  );
}
