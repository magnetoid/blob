/** Where a menu or a popover is drawn: in place, beside the trigger its caller owns.
 *
 * A zero-size anchor where the old panels sat, which the panel is drawn into and hangs
 * from — the box the anchor is positioned in, which is the caller's own wrapper round its
 * trigger. Drawn in place rather than at the end of `<body>`, because the callers' CSS
 * keys on the panel being inside them (the message toolbar stays up on `:focus-within`
 * its row, a message row is lifted by `:has()` while a panel is open in it), because a
 * caller that decides "outside" by `contains` on its own wrapper — the emoji picker's —
 * has to find the panel there, and because Tab from a trigger reaches the panel next.
 * A panel opened inside a dialog is inside the dialog, so it draws over the dialog's
 * contents with no step of its own on the stacking ladder.
 *
 * The anchor is out of the flow and the span round it has no box (`contents`), so neither
 * costs the caller's layout anything, and the anchor still hangs from the caller's own
 * wrapper. The panel is drawn inside that zero-size anchor span: the lazy half, rendered
 * after the anchor, hands it to Base UI as its portal's container, and Base UI draws the
 * popup there.
 *
 * Everything Base UI draws for the panel lands inside the outer span, including the focus
 * guards it puts round a portal to carry Tab from a trigger to a panel drawn somewhere
 * else in the page. This panel is drawn here, so the page's own order already does that,
 * and the guards are taken out of it: left in, the one after the last item swallowed the
 * Tab that should have moved on, because it hands focus to a trigger of Base UI's own,
 * and these panels have none. The attribute is Base UI's, hardcoded in its
 * `utils/FocusGuard` and renamed once before; `Menu.test.tsx` and `Popover.test.tsx` fail
 * if the class here stops matching what Base UI draws.
 *
 * Scaffolding, like the dismissal contract beside it (`lib/useDismissal.ts`): it goes when
 * the callers move to Base UI's own triggers (phases 4 and 5).
 */

import type { ReactNode, RefObject } from 'react';

export function PanelAnchor({
  anchor,
  children,
}: {
  /** The anchor itself: the panel is drawn inside it, and placed against its `offsetParent`. */
  anchor: RefObject<HTMLSpanElement | null>;
  /** The panel, from the overlay chunk — when there is one to draw. */
  children?: ReactNode;
}) {
  return (
    <span className="contents [&_[data-base-ui-focus-guard]]:hidden!">
      <span ref={anchor} className="absolute" />
      {children}
    </span>
  );
}
