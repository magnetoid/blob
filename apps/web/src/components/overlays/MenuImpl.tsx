/**
 * The menu's panel: shadcn's DropdownMenu, which is Base UI's Menu, drawn round whatever
 * the caller put in it.
 *
 * Base UI does what `components/Menu.tsx` used to do by hand, and better: it places the
 * panel against what opened it and keeps it there as the page scrolls and resizes, turns
 * it over to the other side when there is no room where it belongs, caps it to the room
 * there is (`--available-height` — the old `lib/menuFit.ts` measured that once per
 * opening, against the nearest box that clipped), holds it through its exit, and moves
 * focus to its first item. Three things stay Blob's.
 *
 * What the panel answers. The callers write their own items — `<button role="menuitem">`,
 * a heading, a select, a time field — rather than Base UI's `Menu.Item`s, and they own
 * their triggers. Base UI's own interaction (its dismissal, list navigation and typeahead)
 * only knows its own items and triggers, and would get the rest wrong: its dismissal
 * closes on `pointerdown`, before the caller's trigger sees the click it toggles on, and
 * its list navigation spends every arrow key, the select's and the time field's too. So
 * the root is `disabled` — Base UI does not interact — and the house contract in
 * `components/Menu.tsx` answers the keys and clicks, as it did; any close Base UI asks for
 * (focus leaving, say) is declined, because only that contract closes a menu.
 *
 * Where it is drawn. Into the anchor `Menu` leaves where the old panel sat, not at the end
 * of `<body>`: the callers' CSS keys on the panel being inside them — the message toolbar
 * stays up on `:focus-within` its row, a transformed message row is lifted by
 * `:has(.menu)`, the section kebab stays visible on `:focus-within` its heading — and Tab
 * from a trigger reaches the panel next, as it always has. A menu opened inside a dialog
 * is inside the dialog, so it draws over the dialog's contents with no step of its own
 * on the stacking ladder; the panel takes `--z-menu` within whatever it is drawn in, as the
 * old one did. It is clipped by the same scroll areas the old one was, and the positioner's
 * collision boundary is those same areas, so it turns over and caps itself inside them.
 *
 * Where it hangs. The caller's stylesheet says, as it did with `top` and `right`:
 * `--menu-side` (`bottom` or `top`), `--menu-align` (`start` or `end`) and `--menu-gap`
 * (a length in px) on the panel's class, read once as the panel is drawn and before
 * anything is painted — the positioner keeps the panel transparent until it has placed it.
 */

import { useCallback, useState, type ReactNode, type RefObject } from 'react';
import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { DropdownMenu } from '../ui/dropdown-menu.tsx';

type Side = 'top' | 'bottom';
type Align = 'start' | 'end';

interface Placement {
  side: Side;
  align: Align;
  gap: number;
}

/** Below the trigger, from its left edge, 4px clear: the old `.menu`'s `top: calc(100% + 4px); left: 0`. */
const BELOW: Placement = { side: 'bottom', align: 'start', gap: 4 };

/** What the panel's own stylesheet asks for, falling back to `BELOW` for anything it does not say. */
function placementOf(panel: HTMLElement): Placement {
  const style = getComputedStyle(panel);
  const side = style.getPropertyValue('--menu-side').trim();
  const align = style.getPropertyValue('--menu-align').trim();
  const gap = Number.parseFloat(style.getPropertyValue('--menu-gap'));
  return {
    side: side === 'top' ? 'top' : 'bottom',
    align: align === 'end' ? 'end' : 'start',
    gap: Number.isFinite(gap) ? gap : BELOW.gap,
  };
}

/** What the panel hangs from: the box the old panel was positioned in, which is the
 *  caller's own wrapper round its trigger — the anchor itself is a zero-size point. */
function anchorBox(anchor: HTMLElement | null): Element | null {
  return anchor?.offsetParent ?? anchor?.parentElement ?? null;
}

/**
 * The panel itself. Blob's classes here are only where and how it moves; how it looks is the
 * caller's class, legacy CSS, which these outrank by layer. `static` takes back the old
 * panels' own `position`/`top`/`right` — the positioner places it now — `--available-height`
 * caps it with a scroll, never below the 120px the old fitting kept, and it arrives and
 * leaves on the legacy `overlay-in`/`overlay-out`, which travel and scale only by the
 * motion tokens, so under reduced motion it fades and does not move. It grows from the side
 * it hangs from, which Base UI works out (`--transform-origin`).
 */
const PANEL = [
  'static max-h-[max(120px,var(--available-height))] overflow-y-auto outline-none',
  'origin-(--transform-origin)',
  'animate-[overlay-in_var(--dur-open)_var(--blob-ease-out)]',
  'data-ending-style:pointer-events-none',
  'data-ending-style:animate-[overlay-out_var(--dur-exit)_var(--blob-ease-in)_forwards]',
].join(' ');

export interface MenuImplProps {
  /** False while it leaves: Base UI plays the exit, then `onExited` is called. */
  open: boolean;
  /** The span `Menu` draws where the old panel sat. The panel is drawn inside it. */
  anchor: RefObject<HTMLSpanElement | null>;
  /** Goes on the panel, where each caller's CSS expects it. */
  className?: string | undefined;
  onExited?: (() => void) | undefined;
  children: ReactNode;
}

export function MenuImpl({ open, anchor, className, onExited, children }: MenuImplProps) {
  const [placement, setPlacement] = useState<Placement>(BELOW);

  const readPlacement = useCallback((panel: HTMLDivElement | null) => {
    if (!panel) return;
    const next = placementOf(panel);
    setPlacement((current) =>
      current.side === next.side && current.align === next.align && current.gap === next.gap
        ? current
        : next,
    );
  }, []);

  return (
    <DropdownMenu
      open={open}
      modal={false}
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
          <MenuPrimitive.Popup
            ref={readPlacement}
            className={className ? `${PANEL} ${className}` : PANEL}
            // Focus goes home from `Menu`, and only when it was left in the panel.
            finalFocus={false}
            // Still drawn while it leaves, and nothing in it can be clicked or focused.
            inert={!open}
          >
            {children}
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </DropdownMenu>
  );
}
