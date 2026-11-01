/**
 * What the menus and the popovers drawn in place have in common, in the overlay chunk:
 * where the panel hangs, how focus goes into it, and how it moves. `MenuImpl.tsx` and
 * `PopoverImpl.tsx` both draw a Base UI popup into the anchor their first-load half leaves
 * where the old panel sat (`components/PanelAnchor.tsx`), and both read these from here
 * rather than each keeping a copy.
 *
 * Where it hangs. The caller's stylesheet says, as it did with `top` and `right`:
 * `--<kind>-side` (`bottom` or `top`), `--<kind>-align` (`start` or `end`) and
 * `--<kind>-gap` (a length in px) on the panel's class — `--menu-*` for a menu and
 * `--popover-*` for a popover, each registered so it does not inherit — read once as the
 * panel is drawn and before anything is painted: the positioner keeps the panel transparent
 * until it has placed it. What it hangs from is the box the old panel was positioned in,
 * the caller's own wrapper round its trigger; the anchor itself is a zero-size point.
 */

import { useCallback, useState, type RefObject } from 'react';

type Side = 'top' | 'bottom';
type Align = 'start' | 'end';

export interface Placement {
  side: Side;
  align: Align;
  gap: number;
}

/** Below the trigger, from its left edge, 4px clear: the old `.menu`'s `top: calc(100% + 4px); left: 0`. */
const BELOW: Placement = { side: 'bottom', align: 'start', gap: 4 };

/** Whose custom properties a panel's stylesheet sets: `--menu-side` or `--popover-side`. */
export type PanelKind = 'menu' | 'popover';

/** What the panel's own stylesheet asks for, falling back to `BELOW` for anything it does not say. */
function placementOf(panel: HTMLElement, kind: PanelKind): Placement {
  const style = getComputedStyle(panel);
  const side = style.getPropertyValue(`--${kind}-side`).trim();
  const align = style.getPropertyValue(`--${kind}-align`).trim();
  const gap = Number.parseFloat(style.getPropertyValue(`--${kind}-gap`));
  return {
    side: side === 'top' ? 'top' : 'bottom',
    align: align === 'end' ? 'end' : 'start',
    gap: Number.isFinite(gap) ? gap : BELOW.gap,
  };
}

/**
 * Where the panel's stylesheet says it hangs, and the ref that reads it off the panel as the
 * panel is drawn — and keeps the panel in `panelRef`, which focus is sent into from
 * (`takeFocus`). The same object back when nothing changed, so a re-read costs no render.
 */
export function usePlacement(
  kind: PanelKind,
  panelRef: RefObject<HTMLElement | null>,
): readonly [Placement, (panel: HTMLElement | null) => void] {
  const [placement, setPlacement] = useState<Placement>(BELOW);
  const readPlacement = useCallback(
    (panel: HTMLElement | null) => {
      panelRef.current = panel;
      if (!panel) return;
      const next = placementOf(panel, kind);
      setPlacement((current) =>
        current.side === next.side && current.align === next.align && current.gap === next.gap
          ? current
          : next,
      );
    },
    [kind, panelRef],
  );
  return [placement, readPlacement] as const;
}

/** What the panel hangs from: the box the old panel was positioned in, which is the
 *  caller's own wrapper round its trigger — the anchor itself is a zero-size point. */
export function anchorBox(anchor: HTMLElement | null): Element | null {
  return anchor?.offsetParent ?? anchor?.parentElement ?? null;
}

/**
 * Whether the panel may take focus as it opens: only from where it was opened, or from
 * nowhere. A panel opened before the chunk arrived is drawn late, and by then the person
 * may have Tabbed on; taking focus back from there would undo a move they made.
 */
export function mayTakeFocus(opener: RefObject<HTMLElement | null>): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || active === opener.current;
}

/**
 * Focus into a panel as it opens — the `initialFocus` both panels hand Base UI, which calls
 * it as the panel opens — moved here, with `false` back so Base UI moves nothing itself.
 *
 * Base UI moves focus a frame after open, and to anything but the popup itself without
 * `preventScroll`. A frame after open the panel can still be where Base UI put it before
 * the panel's own stylesheet was read: below its trigger, which for the emoji picker and
 * the schedule menu, both hanging above the composer, is off the bottom of the page. The
 * browser scrolled whatever clips the page to bring that spot into view, the shell stayed
 * moved, and the panel turned over below the composer, cut to the room left. The positioner
 * brings a panel into view; focus never scrolls to it.
 *
 * Only from where the panel was opened, or from nowhere (`mayTakeFocus`).
 */
export function takeFocus(opener: RefObject<HTMLElement | null>, target: HTMLElement | null): false {
  if (mayTakeFocus(opener)) target?.focus({ preventScroll: true });
  return false;
}

/**
 * How a panel drawn in place arrives and leaves: on the legacy `overlay-in`/`overlay-out`,
 * which travel and scale only by the motion tokens, so under reduced motion it fades and
 * does not move. It grows from the side it hangs from, which Base UI works out
 * (`--transform-origin`), and nothing in it can be clicked while it leaves.
 */
export const IN_PLACE_MOTION = [
  'origin-(--transform-origin)',
  'animate-[overlay-in_var(--dur-open)_var(--blob-ease-out)]',
  'data-ending-style:pointer-events-none',
  'data-ending-style:animate-[overlay-out_var(--dur-exit)_var(--blob-ease-in)_forwards]',
].join(' ');
