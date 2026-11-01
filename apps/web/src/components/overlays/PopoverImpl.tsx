/**
 * A popover's panel — the person card's, the emoji picker's — drawn by Base UI's Popover
 * (through shadcn's `Popover` root) round whatever the caller put in it, wearing shadcn's
 * popover surface. For now that is Base UI's placing, motion and initial focus and little
 * else — not yet shadcn's Popover as shadcn means it, opened from a `PopoverTrigger`.
 *
 * What Base UI does here: it places the panel against the box it hangs from and keeps it
 * there as the page scrolls and resizes, turns it over to the other side when there is no
 * room where it belongs, and holds it through its exit. Its popup is a dialog, named by the
 * caller. Focus goes into it as it opens — from where it was opened, never from somewhere
 * the person has moved on to since — at the moment Base UI asks, but moved here, without
 * scrolling (`takeFocus` in `./inPlace.ts` says why).
 *
 * What it does not do, and why. Every close Base UI asks for — Escape, a press outside,
 * focus leaving — is declined. Its triggers are the callers' own buttons, not
 * `Popover.Trigger`s, and Escape and a click outside have to work before this chunk has
 * arrived: a card clicked open in the first second after load is open with nothing of
 * Base UI drawn yet. So the person card closes by `lib/useDismissal.ts`, the contract it
 * shares with the menus, and the emoji picker by what its callers already do and by focus
 * moving out of it (`EmojiPicker.tsx` says why) — and only those close a popover.
 * (Popover's root has no `disabled` to switch its interaction off, as the menu's has;
 * declining every change is the same thing from the outside, and a key that reaches it has
 * already passed `lib/useEscape`'s stack.)
 *
 * That is scaffolding, with an exit: it comes down as the callers move to `PopoverTrigger`
 * (phase 5) — the author's name for the person card, "Add reaction" and the composer's
 * emoji button for the picker. What goes then: the cancel-all below, the anchor the panel
 * is drawn into and the focus guards hidden there (`components/PanelAnchor.tsx`), and the
 * dismissal contract in `lib/useDismissal.ts` once the menus have gone the same way.
 *
 * Where it is drawn. Into the anchor its first-load half leaves beside the trigger, not at
 * the end of `<body>` (`PanelAnchor` says why): a caller that asks `contains` of its own
 * wrapper finds the panel there, and a popover opened inside a dialog is inside the dialog,
 * so it is above the dialog's popup with no step of its own on the ladder. Within whatever
 * it is drawn in it takes `--z-popover`, Blob's step, not the generated `z-50`.
 *
 * Where it hangs. The caller's stylesheet says, in `--popover-side`, `--popover-align`
 * and `--popover-gap` on the panel's class (`./inPlace.ts`); below the trigger from its
 * left edge, 4px clear, when it says nothing.
 */

import { useCallback, useRef, type ReactNode, type RefObject } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Popover } from '../ui/popover.tsx';
import { anchorBox, IN_PLACE_MOTION, takeFocus, usePlacement } from './inPlace.ts';

/**
 * shadcn's popover surface — the card, its ring, its shadow, its radius — and how it moves.
 * Size and padding are the caller's: a person card and an emoji grid want different ones.
 * `static` takes back an old panel's own `position` and offsets; the positioner places it.
 */
const SURFACE = [
  'static rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden',
  IN_PLACE_MOTION,
].join(' ');

/** What focus goes to in a panel whose caller names nothing: the first thing in it that
 *  takes focus, as Base UI would choose, or the panel itself. */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The element the caller asked focus to go to, or the first thing in the panel that takes it. */
function focusTarget(
  target: RefObject<HTMLElement | null> | undefined,
  panel: HTMLElement | null,
): HTMLElement | null {
  return target?.current ?? panel?.querySelector<HTMLElement>(FOCUSABLE) ?? panel;
}

export interface PopoverImplProps {
  /** False while it leaves: Base UI plays the exit, then `onExited` is called. */
  open: boolean;
  /** The span its first-load half draws beside the trigger. The panel is drawn inside it. */
  anchor: RefObject<HTMLSpanElement | null>;
  /** What had focus as it opened. Focus is taken into the panel only from there, or from nowhere. */
  opener: RefObject<HTMLElement | null>;
  /** What assistive tech calls it: who or what it is about. */
  label: string;
  /** Goes on the panel: its size and layout, and whatever the caller's CSS keys on. */
  className?: string | undefined;
  /** Where focus goes as it opens, if it goes in at all. Base UI's choice otherwise: the
   *  first thing in it that takes focus. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  onExited?: (() => void) | undefined;
  children: ReactNode;
}

export function PopoverImpl({
  open,
  anchor,
  opener,
  label,
  className,
  initialFocus,
  onExited,
  children,
}: PopoverImplProps) {
  const panel = useRef<HTMLElement | null>(null);
  const [placement, readPlacement] = usePlacement('popover', panel);

  // Moved by `takeFocus`, without scrolling, and Base UI told to move nothing itself
  // (`./inPlace.ts` says why).
  const takesFocus = useCallback(
    () => takeFocus(opener, focusTarget(initialFocus, panel.current)),
    [opener, initialFocus],
  );

  return (
    <Popover
      open={open}
      // Scaffolding until the callers use Base UI's triggers (see above): only Blob's
      // contracts close a popover.
      onOpenChange={(_next, details) => details.cancel()}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onExited?.();
      }}
    >
      <PopoverPrimitive.Portal container={anchor}>
        <PopoverPrimitive.Positioner
          anchor={() => anchorBox(anchor.current)}
          side={placement.side}
          align={placement.align}
          sideOffset={placement.gap}
          className="z-(--z-popover) outline-none"
        >
          <PopoverPrimitive.Popup
            ref={readPlacement}
            data-slot="popover-content"
            aria-label={label}
            className={className ? `${SURFACE} ${className}` : SURFACE}
            initialFocus={takesFocus}
            // Focus goes home from the caller's side, and only when it was left in the panel.
            finalFocus={false}
            // Still drawn while it leaves, and nothing in it can be clicked or focused.
            inert={!open}
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </Popover>
  );
}
