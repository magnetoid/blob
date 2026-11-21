/**
 * A dropdown menu's place on the Escape stack (`lib/useEscape.ts`), taken as it opens.
 *
 * Main's menus were Blob's own (`components/Menu.tsx`), and closed by `lib/useDismissal.ts`,
 * which put each open one on the stack. The shell's four — account, workspace, channel,
 * section — are shadcn's DropdownMenu now, which is Base UI's and answers Escape itself; but
 * the stack's listener is in the capture phase on `window` and stops the key at whatever is
 * innermost there, before Base UI has heard it. A menu that was not on the stack was never
 * innermost. With the file panel open behind it, an Escape closed the panel and left the
 * menu open; in the phone's Sheet it closed the Sheet, because the menu is portalled out of
 * the Sheet's popup and the Sheet took the key for one from outside itself.
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
      ((popupRef.current?.contains(target) ?? false) ||
        (triggerRef.current?.contains(target) ?? false)),
    close: () => setOpen(false),
  }));
  useEscapeLayer(open, standIn);
  return { popupRef, triggerRef };
}
