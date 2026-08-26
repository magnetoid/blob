/** What has been pinned in this channel.
 *
 * Pinning already worked — the message menu has had Pin since blocks landed, the server
 * has `GET /api/channels/:id/pins`, and `api.channels.pins()` sat in the client unused.
 * So you could pin a message and then never find it again, which is worse than not
 * offering the action. This is the way back to them.
 *
 * Fetched when the panel opens rather than when the channel does. Pins are read rarely
 * and a request per channel switch is a real cost for a list most people look at once a
 * week; fetching on open also means it cannot go stale, so pinning a message and opening
 * this needs no cache to invalidate.
 */

import { useEffect, useRef } from 'react';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useStore } from '../../lib/store.ts';
import { renderMarkdown } from '../../lib/markdown.tsx';
import { Avatar } from '../../components/Avatar.tsx';
import { useMentionIndex } from './mentionIndex.ts';

interface Props {
  channelId: string;
  onClose: () => void;
  /** Bring a message into view in the main list, when it is loaded there. */
  onJump: (messageId: string) => void;
}

export function PinnedPanel({ channelId, onClose, onJump }: Props) {
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const customEmoji = useStore((s) => s.customEmoji);
  const displayNameOf = useStore((s) => s.displayNameOf);

  const panelRef = useRef<HTMLDivElement>(null);

  const knownNames = useMentionIndex();

  const { data: pins, error } = useFetch(
    async () => (await api.channels.pins(channelId)).messages,
    [channelId],
  );

  // The same dismissal contract as every other panel here: a click anywhere else, or
  // Escape. Capture phase, so a click that lands on another control closes this first.
  useEffect(() => {
    const onClick = (event: globalThis.MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="pinned-panel" ref={panelRef} role="dialog" aria-label="Pinned messages">
      <h2 className="section-label">Pinned</h2>

      {error && <p className="error-text">Those could not be loaded.</p>}
      {!error && pins === null && <p className="muted">Loading…</p>}
      {pins?.length === 0 && (
        <p className="muted">
          Nothing pinned yet. Pin a message from its ••• menu to keep it here.
        </p>
      )}

      {pins?.map((message) => (
        <button
          key={message.id}
          className="pinned-item"
          onClick={() => {
            onJump(message.id);
            onClose();
          }}
        >
          <Avatar user={message.authorId ? users[message.authorId] : undefined} size="sm" />
          <div style={{ minWidth: 0 }}>
            <div className="pinned-item-author">{displayNameOf(message.authorId)}</div>
            <div className="pinned-item-body">
              {renderMarkdown(message.body, {
                knownNames,
                currentUserId: currentUser?.id ?? null,
                customEmoji,
              })}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
