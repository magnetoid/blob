/**
 * A dropdown menu's place on the Escape stack (`lib/useEscape.ts`), taken as it opens; a
 * popover's too, which is held the same way.
 *
 * Every menu is shadcn's DropdownMenu, and every popover shadcn's Popover, which are Base
 * UI's and answer Escape themselves; but the stack's listener is in the capture phase on
 * `window` and stops the key at whatever is innermost there, before Base UI has heard it. A
 * menu that is not on the stack is never innermost. With the file panel open behind it, an
 * Escape closed the panel and left the menu open; in the phone's Sheet it closed the Sheet,
 * because the menu is portalled out of the Sheet's popup and the Sheet took the key for one
 * from outside itself.
 *
 * So it holds the top as a dialog does (`useEscapeLayer`). A key from inside the popup, or
 * from the trigger, is Base UI's: the stack lets it through, the menu's own handler closes
 * it and stops it there, and focus goes back to the trigger as it always did. Any other —
 * the popup not drawn yet, focus on the page's body — the layer answers by closing the menu
 * through its state, which Base UI also hands focus home from, and nothing beneath hears
 * it. Either way one Escape closes the menu and the next goes on to what is under it. A
 * dialog one of its items opens takes a place of its own above (`components/Dialog.tsx`),
 * and the menu has closed by then, so the dialog's Escape stays the dialog's.
 *
 * A submenu's popup is inside the menu too, though not in its DOM: Base UI portals it beside
 * the menu's popup. Counted as outside, an Escape there was answered by closing the whole
 * menu, and Base UI's own handler — which closes only the submenu and puts focus back on
 * the item it opened from, as the menu pattern says — never heard it. So the layer also
 * holds every popup an item of this menu opened, and theirs in turn, found by the relation
 * assistive tech reads between a submenu's item and its popup (`aria-haspopup="menu"` and
 * `aria-controls`) rather than by where the portal happens to be mounted. A popup no item of
 * this menu opened, another menu's, stays outside.
 *
 * `setOpen` is the menu's state setter, which is stable; the menu must be controlled by it.
 * Put `popupRef` on the `DropdownMenuContent` and `triggerRef` on the `DropdownMenuTrigger`,
 * destructured under those names: that is how the compiler's lint knows them for refs.
 */

import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useEscapeLayer, type StandIn } from './useEscape.ts';

export interface MenuEscapeRefs {
  /** The menu's popup, while it is drawn. */
  popupRef: RefObject<HTMLDivElement | null>;
  /** The button that opens it. */
  triggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Whether `target` is inside `popup`, or inside a submenu's popup an item in it opened, at
 * any depth. The ids are looked up in the popup's own document, and each popup is walked
 * once, so a relation that pointed back would not loop.
 */
function holdsWithSubmenus(popup: Element | null, target: Node): boolean {
  const seen = new Set<Element>();
  const walk = (node: Element | null): boolean => {
    if (!node || seen.has(node)) return false;
    seen.add(node);
    if (node.contains(target)) return true;
    for (const item of node.querySelectorAll('[aria-haspopup="menu"][aria-controls]')) {
      for (const id of (item.getAttribute('aria-controls') ?? '').split(/\s+/)) {
        if (id && walk(node.ownerDocument.getElementById(id))) return true;
      }
    }
    return false;
  };
  return walk(popup);
}

export function useMenuEscapeLayer(
  open: boolean,
  setOpen: Dispatch<SetStateAction<boolean>>,
): MenuEscapeRefs {
  const popupRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // One object for the menu's life: a new one would re-register the layer on top.
  const [standIn] = useState<StandIn>(() => ({
    drawn: () => popupRef.current !== null,
    holds: (target) =>
      target instanceof Node &&
      (holdsWithSubmenus(popupRef.current, target) ||
        (triggerRef.current?.contains(target) ?? false)),
    close: () => setOpen(false),
  }));
  useEscapeLayer(open, standIn);
  return { popupRef, triggerRef };
}
