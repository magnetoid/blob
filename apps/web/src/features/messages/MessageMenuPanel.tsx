/**
 * A message's More actions, as a module of its own (`lazyPopups.ts`): shadcn's
 * DropdownMenu, which is Base UI's, so the arrows, typeahead, Escape, a click outside and
 * focus going back to More actions are all the menu's. The row's More actions button is
 * handed in as `trigger` and is the menu's own; it is drawn only once somebody presses it
 * (`mount: 'press'`), since a virtualised channel mounts rows on every scroll and most are
 * never pressed. While open it holds its place on the Escape stack
 * (`lib/useMenuEscapeLayer.ts`), so that Escape is the menu's and not the thread's behind it.
 *
 * The panel is portalled out of the row, so the toolbar it hangs from would hide the moment
 * the pointer left the row for it; the trigger's `data-popup-open`, and `data-popup-held`
 * until the exit has played, are what keep it up (`styles/app/code-blocks.css`). Drawn open
 * by a key on the placeholder, it starts on its first item, as a key on its own trigger
 * would have it (`openedByKeyboard`). The dialogs its items open are not drawn here — they
 * outlive the menu, so they are `MessageMenu`'s and the row's, and an item asks for one by
 * callback. Choosing it closes the menu, and the dialog gives focus back to the message's
 * row when it ends, because the item is gone and More actions is hidden by then.
 */

import { useState } from 'react';
import type { Message } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { showError } from '../../lib/toasts.ts';
import { useMenuEscapeLayer } from '../../lib/useMenuEscapeLayer.ts';
import type { TriggerModuleProps } from '../../components/lazyTrigger.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';

/** Slack's set, because those are the ones in people's fingers. */
const REMIND_PRESETS: Array<{ label: string; at: () => Date }> = [
  { label: 'In 20 minutes', at: () => new Date(Date.now() + 20 * 60_000) },
  { label: 'In 1 hour', at: () => new Date(Date.now() + 60 * 60_000) },
  { label: 'In 3 hours', at: () => new Date(Date.now() + 3 * 60 * 60_000) },
  {
    label: 'Tomorrow at 9:00',
    at: () => {
      const at = new Date();
      at.setDate(at.getDate() + 1);
      at.setHours(9, 0, 0, 0);
      return at;
    },
  },
  {
    label: 'Next week',
    at: () => {
      const at = new Date();
      at.setDate(at.getDate() + 7);
      at.setHours(9, 0, 0, 0);
      return at;
    },
  },
];

/** The 44px minimum under a coarse pointer. */
const ITEM = 'pointer-coarse:min-h-11';

/**
 * Where focus starts when a key opened the menu: on its first item. `Menu.Popup` reads
 * `initialFocus` and hands it to its focus manager (`MenuPopup.mjs`), as `Popover.Popup`
 * does, though Base UI 1.9's props type for it leaves it out; and focusing an item is what
 * Base UI's highlight follows, so the next arrow goes on from there.
 */
type InitialFocus = { initialFocus?: () => HTMLElement | true };

export interface MessageMenuPanelProps extends TriggerModuleProps {
  message: Message;
  /** Edit and delete are offered only on your own messages. */
  mine: boolean;
  onCopyLink: () => void;
  onForward: () => void;
  /** Absent inside a work channel, where the work already is. */
  onStartWork?: (() => void) | undefined;
  onEdit: () => void;
  onDelete: () => void;
  /** Opens "Record a decision", which `MessageMenu` draws. */
  onRecordDecision: () => void;
  /** Opens Earlier versions, which `MessageMenu` draws. */
  onEarlierVersions: () => void;
}

export default function MessageMenuPanel({
  trigger,
  defaultOpen,
  openedByKeyboard,
  message,
  mine,
  onCopyLink,
  onForward,
  onStartWork,
  onEdit,
  onDelete,
  onRecordDecision,
  onEarlierVersions,
}: MessageMenuPanelProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const { popupRef, triggerRef } = useMenuEscapeLayer(open, setOpen);
  // From the open until the exit has played, which `data-popup-open` does not cover: it goes
  // as the close begins, and the toolbar's hold with it (`styles/app/code-blocks.css`).
  // Adjusted during render, as `DialogPresence` adjusts its own.
  const [held, setHeld] = useState(open);
  if (open && !held) setHeld(true);
  // The open this was drawn with, if a key made it on the placeholder, which Base UI never
  // heard. Spent as it closes: every later open is the real trigger's, read by Base UI.
  const [keyOpened, setKeyOpened] = useState(open && openedByKeyboard === true);
  if (!open && keyOpened) setKeyOpened(false);
  const firstItem: InitialFocus = keyOpened
    ? {
        initialFocus: () =>
          popupRef.current?.querySelector<HTMLElement>('[role="menuitem"]') ?? true,
      }
    : {};
  // An admin may read what a legal hold kept of an edited message (ADR 0039 addendum).
  const isAdmin = useStore(
    (s) => s.currentUser?.role === 'admin' || s.currentUser?.role === 'owner',
  );
  const markUnread = useStore((s) => s.markUnread);
  const toggleSaved = useStore((s) => s.toggleSaved);
  // Subscribed to the boolean rather than the Set, so saving one message does not
  // re-render the menu of every other row that has drawn one.
  const saved = useStore((s) => s.savedMessageIds.has(message.id));

  function remind(at: Date) {
    void api.later
      .update(message.id, { remindAt: at.toISOString() })
      .then(() =>
        useStore.setState((s) => ({
          savedMessageIds: new Set(s.savedMessageIds).add(message.id),
        })),
      )
      .catch(showError);
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) setHeld(false);
      }}
    >
      <DropdownMenuTrigger
        ref={triggerRef}
        render={trigger}
        data-popup-held={held ? '' : undefined}
      />
      {/* Hung from the right of its trigger, at the right edge of the row; narrower than
          a channel menu, because its rows are a word or two. */}
      <DropdownMenuContent
        ref={popupRef}
        align="end"
        className="w-auto min-w-42"
        {...firstItem}
      >
        {/* First, because it is the one people reach for most: a message is quoted into
            another channel or a ticket far more often than it is pinned or saved. */}
        <DropdownMenuItem className={ITEM} onClick={onCopyLink}>
          Copy link
        </DropdownMenuItem>
        {/* Beside Copy link because they answer the same question — "send this somewhere
            else" — and differ only in who does the walking. */}
        <DropdownMenuItem className={ITEM} onClick={onForward}>
          Forward…
        </DropdownMenuItem>
        {/* Where a conversation becomes a place to build something: a private channel spun
            from this message, with the agents you name. Not offered inside a work channel —
            the work is already here. */}
        {onStartWork && (
          <DropdownMenuItem className={ITEM} onClick={onStartWork}>
            Start work from here…
          </DropdownMenuItem>
        )}
        {/* Only in the channel, not in a thread: the read cursor is a channel cursor, so
            marking a reply unread would move a marker pointing at something the channel
            list does not show. */}
        {!message.threadRootId && (
          <DropdownMenuItem
            className={ITEM}
            onClick={() => void markUnread(message.channelId, message.id).catch(showError)}
          >
            Mark unread
          </DropdownMenuItem>
        )}
        {/* Above pinning, and worded to draw the line between them: this one is yours and
            tells nobody, pinning is the channel's and tells everybody. Slack orders them
            the same way. */}
        <DropdownMenuItem
          className={ITEM}
          onClick={() => void toggleSaved(message.id).catch(showError)}
        >
          {saved ? 'Remove from later' : 'Save for later'}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className={ITEM}>Remind me…</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {REMIND_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                className={ITEM}
                onClick={() => remind(preset.at())}
              >
                {preset.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          className={ITEM}
          onClick={() =>
            void api.messages.pin(message.id, message.pinnedAt === null).catch(showError)
          }
        >
          {message.pinnedAt ? 'Unpin' : 'Pin to channel'}
        </DropdownMenuItem>
        {/* Beside Pin: both mark a message for the whole channel. A message is the source of
            one standing decision at a time, so one that already is opens the log instead. */}
        <DropdownMenuItem
          className={ITEM}
          onClick={() => {
            if (message.decisionId) navigate('/decisions');
            else onRecordDecision();
          }}
        >
          {message.decisionId ? 'Open the decision' : 'Record as a decision'}
        </DropdownMenuItem>
        {/* Not a poll's: its question cannot change under the answers (ADR 0041). */}
        {mine && !message.poll && (
          <DropdownMenuItem className={ITEM} onClick={onEdit}>
            Edit message
          </DropdownMenuItem>
        )}
        {isAdmin && message.editedAt && (
          <DropdownMenuItem className={ITEM} onClick={onEarlierVersions}>
            Earlier versions
          </DropdownMenuItem>
        )}
        {mine && (
          <DropdownMenuItem variant="destructive" className={ITEM} onClick={onDelete}>
            Delete message
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
