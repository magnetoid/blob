/** Who somebody is, and the button that starts a conversation with them.
 *
 * Until this existed, two places in the whole client could open a direct message: the
 * sidebar row and ⌘K. Clicking a person's name or avatar on a message — the gesture
 * every chat app has trained people to make — did nothing at all.
 *
 * Built on `Menu` rather than as a fourth hand-rolled popover: it already owns the
 * dismissal contract (outside click, Escape through the stack, arrow keys) that three
 * separate copies of this got subtly wrong before.
 */

import { useEffect, useState } from 'react';
import type { User } from '@blob/shared';
import { Menu } from './Menu.tsx';
import { Avatar } from './Avatar.tsx';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/store.ts';
import { showError } from '../lib/toasts.ts';
import { showChannel } from '../lib/navigation.ts';

export function PersonCard({
  person,
  open,
  onClose,
}: {
  person: User;
  open: boolean;
  onClose: () => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const live = useStore((s) => s.users[person.id]) ?? person;
  const [busy, setBusy] = useState(false);
  const isMe = person.id === currentUser?.id;

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    void api.users
      .get(person.id)
      .then(({ user }) => {
        if (cancelled) return;
        useStore.setState((s) => ({ users: { ...s.users, [user.id]: { ...s.users[user.id], ...user } } }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, person.id]);

  async function message() {
    if (busy) return;
    setBusy(true);
    try {
      const { channel } = await api.dms.open([person.id]);
      useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      onClose();
      await showChannel(channel.id);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Menu open={open} onClose={onClose} className="menu person-card">
      <div className="person-card-head">
        <Avatar user={live} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="person-card-name">{live.displayName}</div>
          {live.fullName && live.fullName !== live.displayName && (
            <div className="person-card-title">{live.fullName}</div>
          )}
          {live.title && <div className="person-card-title">{live.title}</div>}
          {live.timezone && live.timezone !== 'UTC' && (
            <div className="person-card-title">{live.timezone}</div>
          )}
          {(live.statusEmoji || live.statusText) && (
            <div className="person-card-status">
              {live.statusEmoji && <span>{live.statusEmoji}</span>}
              {live.statusText && <span>{live.statusText}</span>}
            </div>
          )}
        </div>
      </div>

      {/* A conversation with yourself is a real place — it is where /remind writes — but
          "Message" on your own name reads as a mistake, so the card says what it is. */}
      <button
        className="menu-item"
        role="menuitem"
        type="button"
        disabled={busy}
        onClick={() => void message()}
      >
        {isMe ? 'Open your own messages' : `Message ${live.displayName}`}
      </button>
    </Menu>
  );
}
