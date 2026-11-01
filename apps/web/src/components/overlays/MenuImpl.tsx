/**
 * The menu's panel, drawn by Base UI's Menu (through shadcn's `DropdownMenu` root) round
 * whatever the caller put in it. For now that is Base UI's positioning and little else —
 * not yet shadcn's DropdownMenu as shadcn means it, with Base UI's triggers and items.
 *
 * What Base UI does here: it places the panel against the box it hangs from and keeps it
 * there as the page scrolls and resizes, turns it over to the other side when there is no
 * room where it belongs, caps it to the room there is (`--available-height` — the old
 * `lib/menuFit.ts` measured that once per opening, against the nearest box that clipped),
 * and holds it through its exit. And it says when focus goes in as the menu opens: to its
 * first item, moved by `takeFocus` (`./inPlace.ts`) without scrolling — from where the menu
 * was opened, never from somewhere the person has moved on to since.
 *
 * What it does not do, and why. Its interaction — dismissal, list navigation, typeahead —
 * is switched off (`disabled`), and every close it asks for is declined, for two reasons.
 * The callers' items are their own `<button role="menuitem">`s beside a heading, a select
 * and a time field, not registered `Menu.Item`s, so Base UI's list navigation and
 * typeahead would never walk them; and its `useListNavigation` would stop the arrow keys
 * inside the schedule menu's repeat select and time field, which need them. And Escape and
 * a click outside have to work before this chunk has arrived — a menu clicked open in the
 * first second after load is open with nothing of Base UI drawn yet — so dismissal lives in
 * first-load code (`lib/useDismissal.ts`, which `Menu` and `Popover` share), and only that
 * contract closes a menu.
 *
 * That is scaffolding, with an exit. It comes down as the callers move to
 * `DropdownMenuTrigger` and `DropdownMenuItem` — TopBar's account menu, the section menu
 * and ChannelMenu in phase 4, MessageMenu in phase 5 — and SchedulePicker becomes a
 * Popover. What goes then: `disabled` and the cancel-all below, the anchor span `Menu`
 * draws the panel into and the focus guards hidden there (`PanelAnchor`), the arrows in
 * `Menu.tsx`, and — once the popovers have gone the same way — the dismissal contract in
 * `lib/useDismissal.ts`.
 *
 * Where it is drawn. Into the anchor `Menu` leaves where the old panel sat
 * (`components/PanelAnchor.tsx` says why), not at the end of `<body>`; the panel takes
 * `--z-menu` within whatever it is drawn in, as the old one did. It is clipped by the same
 * scroll areas the old one was, and the positioner's collision boundary is those same
 * areas, so it turns over and caps itself inside them.
 *
 * Where it hangs. The caller's stylesheet says, as it did with `top` and `right`:
 * `--menu-side`, `--menu-align` and `--menu-gap` on the panel's class (`./inPlace.ts`,
 * which `PopoverImpl` reads the same way).
 */

import {
  useCallback,
  useRef,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type RefObject,
} from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { DropdownMenu } from '../ui/dropdown-menu.tsx';
import { MENU_ITEM } from '../menuItems.ts';
import { anchorBox, IN_PLACE_MOTION, takeFocus, usePlacement } from './inPlace.ts';

/**
 * Base UI's menu popup, with the `initialFocus` it reads but does not declare. In 1.9 the
 * popup hands it to its focus manager exactly as Popover's and Dialog's popups do — called
 * as the menu opens; `false` back leaves focus where it is, which is what `takeFocus`
 * answers once it has moved focus itself — but leaves it out of `MenuPopupProps`.
 * `Menu.chunk.test.tsx` and `Menu.focus.test.tsx` fail if a release stops reading it: Base UI
 * would then take focus back from where the person moved it, and scroll to its first item.
 */
const MenuPopup = MenuPrimitive.Popup as ComponentType<
  ComponentProps<typeof MenuPrimitive.Popup> & { initialFocus?: () => boolean }
>;

/**
 * The panel itself. Blob's classes here are only where and how it moves; how it looks is the
 * caller's class, legacy CSS, which these outrank by layer. `static` takes back the old
 * panels' own `position`/`top`/`right` — the positioner places it now — and
 * `--available-height` caps it with a scroll, never below the 120px the old fitting kept.
 * It arrives and leaves as every panel drawn in place does (`IN_PLACE_MOTION`).
 */
const PANEL = [
  'static max-h-[max(120px,var(--available-height))] overflow-y-auto outline-none',
  IN_PLACE_MOTION,
].join(' ');

/** The menu's first item that can take focus, or the panel itself when it has none. */
function firstItem(panel: HTMLElement | null): HTMLElement | null {
  return panel?.querySelector<HTMLElement>(MENU_ITEM) ?? panel;
}

export interface MenuImplProps {
  /** False while it leaves: Base UI plays the exit, then `onExited` is called. */
  open: boolean;
  /** The span `Menu` draws where the old panel sat. The panel is drawn inside it. */
  anchor: RefObject<HTMLSpanElement | null>;
  /** What had focus when the menu opened — `Menu`'s, which is where focus goes home to. */
  opener: RefObject<HTMLElement | null>;
  /** Goes on the panel, where each caller's CSS expects it. */
  className?: string | undefined;
  onExited?: (() => void) | undefined;
  children: ReactNode;
}

export function MenuImpl({ open, anchor, opener, className, onExited, children }: MenuImplProps) {
  const panel = useRef<HTMLElement | null>(null);
  const [placement, readPlacement] = usePlacement('menu', panel);

  // To its first item that can take focus — the one the arrows in `Menu` start from — or to
  // the panel when it has none; moved by `takeFocus`, without scrolling, and Base UI told to
  // move nothing itself (`./inPlace.ts` says why).
  const takesFocus = useCallback(
    () => takeFocus(opener, firstItem(panel.current)),
    [opener],
  );

  return (
    <DropdownMenu
      open={open}
      modal={false}
      // Scaffolding until the callers use Base UI's triggers and items (see above): Base UI
      // does not interact, and only `Menu`'s contract closes a menu.
      disabled
      onOpenChange={(_next, details) => details.cancel()}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onExited?.();
      }}
    >
      <MenuPrimitive.Portal container={anchor}>
        <MenuPrimitive.Positioner
          anchor={() => anchorBox(anchor.current)}
          side={placement.side}
          align={placement.align}
          sideOffset={placement.gap}
          className="z-(--z-menu) outline-none"
        >
          <MenuPopup
            ref={readPlacement}
            className={className ? `${PANEL} ${className}` : PANEL}
            // Into the panel only from where the menu was opened, or from nowhere. A menu
            // opened before the chunk arrived is drawn late, and by then the person may have
            // Tabbed on: taking focus back from there would undo a move they made.
            initialFocus={takesFocus}
            // Focus goes home from `Menu`, and only when it was left in the panel.
            finalFocus={false}
            // Still drawn while it leaves, and nothing in it can be clicked or focused.
            inert={!open}
          >
            {children}
          </MenuPopup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </DropdownMenu>
  );
}
