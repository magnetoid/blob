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
 */

import { useState } from 'react';
import type { ChannelWithState, NotifyLevel } from '@blob/shared';
import { api, ApiError } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { Menu } from '../../components/Menu.tsx';

interface Props {
  channel: ChannelWithState;
  onClose: () => void;
  onOpenDetails: () => void;
}

const LEVELS: { value: NotifyLevel; label: string; hint: string }[] = [
  { value: 'all', label: 'Every message', hint: 'Notify me for all activity here' },
  { value: 'mentions', label: 'Mentions', hint: 'Only when somebody says my name' },
  { value: 'none', label: 'Nothing', hint: 'Muted — it stays unread, it never notifies' },
];

export function ChannelMenu({ channel, onClose, onOpenDetails }: Props) {
  const currentUser = useStore((s) => s.currentUser);
  const leaveChannel = useStore((s) => s.leaveChannel);
  const [confirming, setConfirming] = useState<'leave' | 'archive' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isDm = channel.kind === 'dm' || channel.kind === 'group_dm';
  const archived = channel.archivedAt !== null;
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner';
  const level = channel.membership?.notifyLevel ?? 'mentions';
  const starred = channel.membership?.isStarred ?? false;

  /** The server echoes the channel to this user's own sockets, so there is nothing to
   *  write here — `channel.updated` arrives and the store applies it. */
  async function setMembership(input: { notifyLevel?: NotifyLevel; isStarred?: boolean }) {
    setError(null);
    try {
      await api.channels.setMembership(channel.id, input);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That did not take.');
    }
  }

  return (
    <>
      {/* The confirm dialogs below render beside this menu, not inside it, so every
          click in one is "outside" by the dismissal's contains test — dismissal has
          to sit out while a dialog is up, or the click that asked for the dialog
          would unmount it along with the menu. */}
      <Menu open onClose={onClose} className="menu" suspendDismiss={confirming !== null}>
        {!isDm && (
          <>
            <p className="menu-label">Notifications</p>
            {LEVELS.map((option) => (
              <button
                key={option.value}
                className="menu-item"
                role="menuitemradio"
                aria-checked={level === option.value}
                title={option.hint}
                onClick={() => void setMembership({ notifyLevel: option.value })}
              >
                <span className="menu-check" aria-hidden="true">
                  {level === option.value ? '✓' : ''}
                </span>
                {option.label}
              </button>
            ))}
            <div className="menu-sep" />
          </>
        )}

        <button
          className="menu-item"
          role="menuitem"
          onClick={() => void setMembership({ isStarred: !starred })}
        >
          <span className="menu-check" aria-hidden="true">
            {starred ? '★' : '☆'}
          </span>
          {starred ? 'Remove from starred' : 'Star this channel'}
        </button>

        {!isDm && (
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              onClose();
              onOpenDetails();
            }}
          >
            <span className="menu-check" aria-hidden="true" />
            Channel details
          </button>
        )}

        {!isDm && (
          <>
            <div className="menu-sep" />
            <button
              className="menu-item menu-item-danger"
              role="menuitem"
              onClick={() => setConfirming('leave')}
            >
              <span className="menu-check" aria-hidden="true" />
              Leave channel
            </button>
            {isAdmin && !archived && (
              <button
                className="menu-item menu-item-danger"
                role="menuitem"
                onClick={() => setConfirming('archive')}
              >
                <span className="menu-check" aria-hidden="true" />
                Archive channel
              </button>
            )}
          </>
        )}

        {error && (
          <p className="error-text" style={{ margin: '6px 9px 2px' }}>
            {error}
          </p>
        )}
      </Menu>

      {confirming === 'leave' && (
        <ConfirmDialog
          title={`Leave #${channel.name}?`}
          body={
            channel.kind === 'private'
              ? 'This channel is private, so you will not be able to find it again unless somebody adds you back.'
              : 'You can rejoin whenever you like. Nothing is deleted.'
          }
          confirmLabel="Leave"
          danger
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onClose();
            void leaveChannel(channel.id).catch(() =>
              setError('Could not leave that channel.'),
            );
          }}
        />
      )}

      {confirming === 'archive' && (
        <ConfirmDialog
          title={`Archive #${channel.name}?`}
          body="It becomes read-only for everybody. Its history stays searchable."
          confirmLabel="Archive"
          danger
          onClose={() => setConfirming(null)}
          onConfirm={() => {
            setConfirming(null);
            onClose();
            void api.channels
              .archive(channel.id)
              .catch(() => setError('Could not archive that channel.'));
          }}
        />
      )}
    </>
  );
}
