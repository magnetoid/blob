/** Where a menu's panel goes so all of it can be seen (components/Menu.tsx).
 *
 * Below its trigger, as the CSS has it, unless the box that clips it has more room above —
 * the ••• on the newest message sits at the foot of the conversation's scroll area, and a
 * panel dropped from there was cut off after its first item — and capped, scrolling, when
 * it fits on neither side. A pure rule over three boxes, so it is tested without a layout.
 */

/** The panel's gap from its trigger, as the CSS sets it (`calc(100% + 4px)`). */
const GAP = 4;
/** Below this, a capped panel is too short to be worth scrolling: it keeps this much. */
const MIN_HEIGHT = 120;

export interface Fit {
  above: boolean;
  /** Set only when the panel fits on neither side: it then scrolls, at this height. */
  maxHeight: number | null;
}

export function fitPanel(
  panel: { height: number },
  trigger: { top: number; bottom: number },
  bounds: { top: number; bottom: number },
): Fit {
  const below = bounds.bottom - trigger.bottom - GAP;
  const above = trigger.top - bounds.top - GAP;
  if (panel.height <= below) return { above: false, maxHeight: null };
  if (panel.height <= above) return { above: true, maxHeight: null };
  const roomier = above > below;
  return { above: roomier, maxHeight: Math.max(roomier ? above : below, MIN_HEIGHT) };
}
