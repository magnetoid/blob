/** What you can do to the channel you are reading.
 *
 * Every action here already had a route and a typed client method; none of them had a
 * control. `channel_members` has carried `notify_level` and `is_starred` from the
 * beginning, `notify.decide` honours the first (`none` skips a recipient outright,
 * `all` adds all-activity notifications) and the sidebar *sorts* by the second — so
 * starred channels have always floated to the top of a list where nothing could star
 * one. Leaving was reachable only by typing `/leave`, and a topic only by `/topic`.
 *
 * Behind the channel name because that is where somebody arriving from Slack reaches
 * for it, and because a header full of buttons for things done once a month costs
 * attention on every message read in between.
 *
 * A module for `lazyDropdown` (`components/lazyDropdown.tsx`): the row's Options button, or
 * the conversation's name, is handed in as `trigger` and is the menu's own, so Base UI owns
 * the arrows, Escape and focus going home. The dialogs it opens are drawn beside the menu,
 * not inside it: choosing an item closes the menu and the dialog stays. When one closes,
 * focus goes back to the trigger, because the item it was opened from is gone.
 */

import { useRef, useState } from 'react';
import type { ChannelWithState, NotifyLevel } from '@blob/shared';
import { api, ApiError } from '../../lib/api.ts';
import { usePath } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { DialogPresence } from '../../components/Dialog.tsx';
import type { DropdownModuleProps } from '../../components/lazyDropdown.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import { MoveToSectionDialog } from './SectionDialogs.tsx';

interface Props extends DropdownModuleProps {
  channel: ChannelWithState;
  onOpenDetails: () => void;
  /** Open the agent runs here — or, in an agent's own DM, everything it has done that
   *  you can see. Absent where there is nothing to show. */
  onOpenRuns?: () => void;
  /** What that item says: "Agent runs", or the agent's own runs in its DM. */
  runsLabel?: string;
}

const LEVELS: { value: NotifyLevel; label: string; hint: string }[] = [
  { value: 'all', label: 'Every message', hint: 'Notify me for all activity here' },
  { value: 'mentions', label: 'Mentions', hint: 'Only when somebody says my name' },
  { value: 'none', label: 'Nothing', hint: 'Muted — it stays unread, it never notifies' },
];

const ITEM = 'pointer-coarse:min-h-11';

export default function ChannelMenu({
  trigger,
  defaultOpen,
  channel,
  onOpenDetails,
  onOpenRuns,
  runsLabel = 'Agent runs',
}: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const leaveChannel = useStore((s) => s.leaveChannel);
  const [confirming, setConfirming] = useState<'leave' | 'archive' | 'section' | null>(null);
  const channelTitle = useStore((s) => s.channelTitle);
  const inSection = useStore(
    (s) =>
      (s.currentUser?.prefs?.sidebarSections ?? []).some((section) =>
        section.channelIds.includes(channel.id),
      ),
  );
  const path = usePath();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // A navigation that did not come from this menu (Back, a link in the page) must not
  // leave it open behind the new screen. Adjusted during render, as AccountMenu does.
  const [menuPath, setMenuPath] = useState(path);
  if (menuPath !== path) {
    setMenuPath(path);
    setOpen(false);
  }

  const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
  const archived = channel.archivedAt !== null;
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const level = channel.membership?.notifyLevel ?? 'mentions';
  const starred = channel.membership?.isStarred ?? false;

  /** The server echoes this to this user's own sockets, so there is nothing to write
   *  here — `channel.membership` arrives and the store applies it. Only to them: how
   *  loud a channel is for one person is nobody else's business. A failure keeps the
   *  menu open, with the reason in it. */
  async function setMembership(input: { notifyLevel?: NotifyLevel; isStarred?: boolean }) {
    setError(null);
    try {
      await api.channels.setMembership(channel.id, input);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not take.');
    }
  }

  /** A dialog is over, however it ended: the item that opened it is gone, so focus goes
   *  to the button the menu hangs from. */
  function dialogDone() {
    setConfirming(null);
    triggerRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (next) setError(null);
          setOpen(next);
        }}
      >
        <DropdownMenuTrigger ref={triggerRef} render={trigger} />
        <DropdownMenuContent align="start" sideOffset={6} className="w-auto min-w-56">
          {!isDm && (
            <>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={level}
                  onValueChange={(value) =>
                    void setMembership({ notifyLevel: value as NotifyLevel })
                  }
                >
                  {LEVELS.map((option) => (
                    <DropdownMenuRadioItem
                      key={option.value}
                      value={option.value}
                      title={option.hint}
                      className={ITEM}
                      closeOnClick={false}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem
            className={ITEM}
            closeOnClick={false}
            onClick={() => void setMembership({ isStarred: !starred })}
          >
            {starred ? 'Remove from starred' : 'Star this channel'}
          </DropdownMenuItem>

          {/* Sections of your own in the channel list (M3 · B3) — DMs too, as in Slack. */}
          <DropdownMenuItem className={ITEM} onClick={() => setConfirming('section')}>
            {inSection ? 'Move to another section…' : 'Move to a section…'}
          </DropdownMenuItem>

          {!isDm && (
            <DropdownMenuItem className={ITEM} onClick={onOpenDetails}>
              Channel details
            </DropdownMenuItem>
          )}

          {onOpenRuns && (
            <DropdownMenuItem className={ITEM} onClick={onOpenRuns}>
              {runsLabel}
            </DropdownMenuItem>
          )}

          {!isDm && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                className={ITEM}
                onClick={() => setConfirming('leave')}
              >
                Leave channel
              </DropdownMenuItem>
              {isAdmin && !archived && (
                <DropdownMenuItem
                  variant="destructive"
                  className={ITEM}
                  onClick={() => setConfirming('archive')}
                >
                  Archive channel
                </DropdownMenuItem>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="px-1.5 pt-1.5 pb-0.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DialogPresence when={confirming === 'leave'}>
        {() => (
          <ConfirmDialog
            title={`Leave #${channel.name}?`}
            body={
              channel.kind === 'private'
                ? 'This channel is private, so you will not be able to find it again unless somebody adds you back.'
                : 'You can rejoin whenever you like. Nothing is deleted.'
            }
            confirmLabel="Leave"
            danger
            onClose={dialogDone}
            onConfirm={() => {
              dialogDone();
              void leaveChannel(channel.id).catch(() => {
                setError('Could not leave that channel.');
                setOpen(true);
              });
            }}
          />
        )}
      </DialogPresence>

      <DialogPresence when={confirming === 'section'}>
        {() => (
          <MoveToSectionDialog
            conversationId={channel.id}
            name={channelTitle(channel)}
            onClose={dialogDone}
          />
        )}
      </DialogPresence>

      <DialogPresence when={confirming === 'archive'}>
        {() => (
          <ConfirmDialog
            title={`Archive #${channel.name}?`}
            body="It becomes read-only for everybody. Its history stays searchable."
            confirmLabel="Archive"
            danger
            onClose={dialogDone}
            onConfirm={() => {
              dialogDone();
              void api.channels.archive(channel.id).catch(() => {
                setError('Could not archive that channel.');
                setOpen(true);
              });
            }}
          />
        )}
      </DialogPresence>
    </>
  );
}
