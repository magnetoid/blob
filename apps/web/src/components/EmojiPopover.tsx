/**
 * The emoji picker as a module of its own (`features/messages/lazyPopups.ts`): shadcn's
 * Popover, which is Base UI's, round the picker's body (`EmojiPicker.tsx`). The button that
 * opens it — a message's Add reaction, the composer's Emoji — is handed in as `trigger` and
 * is the popover's own button, so a click outside, Escape, and focus going back to that
 * button are all Base UI's.
 *
 * It opens with the cursor in its search field, and a pick closes it. While open it holds
 * its place on the Escape stack (`lib/useMenuEscapeLayer.ts`), so that Escape is the
 * picker's and not the thread's or the file panel's behind it. From the open until its exit
 * has played it marks its trigger `data-popup-held`, which keeps a message's toolbar, where
 * Add reaction sits, up until Base UI has given focus back (`styles/app/code-blocks.css`).
 * Both of its triggers sit in UI that is drawn many times over or remounted often — a
 * message row in a virtualised list, a thread's composer — so it is drawn only once its
 * trigger is pressed (`mount: 'press'`).
 *
 * Where focus goes after a pick is left as Base UI leaves it: back to the trigger, unless
 * something has taken it by the time the popup has gone. The composer does — it puts focus
 * back in the message field after the emoji it inserted (`Composer.insertAtCursor`) — and
 * Base UI does not take focus back from somewhere outside the popup.
 */

import { useRef, useState } from 'react';
import { useMenuEscapeLayer } from '../lib/useMenuEscapeLayer.ts';
import { EmojiPicker } from './EmojiPicker.tsx';
import type { TriggerModuleProps } from './lazyTrigger.tsx';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.tsx';

export interface EmojiPopoverProps extends TriggerModuleProps {
  /** What assistive tech calls it: "React with an emoji", or "Insert an emoji". */
  label: string;
  /** Which side of its trigger it hangs on. */
  side: 'top' | 'bottom';
  /** Which of its trigger's edges it lines up with. */
  align: 'start' | 'end';
  /** Receives the value to store: the character, or `:name:` for a custom emoji. */
  onPick: (value: string) => void;
}

export default function EmojiPopover({
  trigger,
  defaultOpen,
  label,
  side,
  align,
  onPick,
}: EmojiPopoverProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { popupRef, triggerRef } = useMenuEscapeLayer(open, setOpen);
  const searchRef = useRef<HTMLInputElement>(null);
  // From the open until the exit has played, as `MessageMenuPanel` holds its own.
  const [held, setHeld] = useState(open);
  if (open && !held) setHeld(true);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) setHeld(false);
      }}
    >
      <PopoverTrigger
        ref={triggerRef}
        render={trigger}
        data-popup-held={held ? '' : undefined}
      />
      {/* The picker's own size, and a column its search, grid and tones are laid out in,
          capped to the room there is on the side it hangs. 6px clear of its trigger. */}
      <PopoverContent
        ref={popupRef}
        side={side}
        align={align}
        sideOffset={6}
        aria-label={label}
        initialFocus={searchRef}
        className="max-h-[min(332px,var(--available-height))] w-78 gap-2 p-2"
      >
        <EmojiPicker
          searchRef={searchRef}
          onPick={(value) => {
            setOpen(false);
            onPick(value);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
