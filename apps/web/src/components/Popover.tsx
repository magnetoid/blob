/** A panel about something, beside a trigger the caller renders: the person card today.
 *
 * The same shape as `Menu`, and the same dismissal — a click outside the panel by
 * `contains`, Escape through the shared stack, focus moving out of it, all suspended while
 * the caller has a dialog up, and focus home to the trigger on close. That contract is
 * `lib/useDismissal.ts`, which both use rather than each keeping a copy: three copies of
 * it drifted apart before there was one. What a popover does not have is a menu's arrows,
 * because what is inside it is not a list of items; and its panel is a dialog, named for
 * what it is about, rather than a menu.
 *
 * The panel is drawn by Base UI's Popover, through shadcn's `Popover` root, in the overlay
 * chunk (`components/overlays/PopoverImpl.tsx`): it places the panel, plays its exit, moves
 * focus into it and wears shadcn's popover surface. Its own dismissal is declined, so the
 * contract here holds from the first click — a card opened before the chunk lands already
 * answers Escape and a click outside, and opens once the chunk is here. This file is what
 * the first load carries: the contract, and the anchor the panel is drawn into
 * (`PanelAnchor`).
 *
 * Scaffolding, with an exit: the callers move to `PopoverTrigger` in phase 5, and then this
 * file, the anchor and the declined closes go (`PopoverImpl.tsx` says what else).
 */

import { useRef, type ReactNode } from 'react';
import { lazyOverlay } from './lazyOverlay.tsx';
import { PanelAnchor } from './PanelAnchor.tsx';
import { useDismissal } from '../lib/useDismissal.ts';
import { useHeldThroughExit } from '../lib/useHeldThroughExit.ts';

/** Base UI's root, portal, positioner and popup, from the overlay chunk. */
const PopoverPanel = lazyOverlay((m) => m.PopoverImpl);

interface Props {
  open: boolean;
  onClose: () => void;
  /** What assistive tech calls the panel: who or what it is about. */
  label: string;
  /** Goes on the panel element itself: its size and layout, beside shadcn's surface. */
  className?: string;
  /** True while the caller has a dialog up: dismissing would unmount the dialog too. */
  suspendDismiss?: boolean;
  children: ReactNode;
}

export function Popover({
  open,
  onClose,
  label,
  className,
  suspendDismiss = false,
  children,
}: Props) {
  // Where the panel is drawn — so `contains` on it is "inside the panel" — and hangs from
  // the box this is positioned in, the caller's own wrapper round its trigger.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const opener = useDismissal(anchorRef, { open, suspended: suspendDismiss, onClose });
  const [drawn, exited] = useHeldThroughExit(open);

  return (
    <PanelAnchor anchor={anchorRef}>
      {drawn && (
        <PopoverPanel
          open={open}
          anchor={anchorRef}
          opener={opener}
          label={label}
          className={className}
          onExited={exited}
        >
          {children}
        </PopoverPanel>
      )}
    </PanelAnchor>
  );
}
