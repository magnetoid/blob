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

import { useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const isMe = person.id === currentUser?.id;

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
        <Avatar user={person} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div className="person-card-name">{person.displayName}</div>
          {person.title && <div className="person-card-title">{person.title}</div>}
          {(person.statusEmoji || person.statusText) && (
            <div className="person-card-status">
              {person.statusEmoji && <span>{person.statusEmoji}</span>}
              {person.statusText && <span>{person.statusText}</span>}
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
        {isMe ? 'Open your own messages' : `Message ${person.displayName}`}
      </button>
    </Menu>
  );
}
