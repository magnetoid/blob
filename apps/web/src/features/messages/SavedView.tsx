/** Later — messages you put aside for yourself.
 *
 * The one Slack habit this app had no answer for at all. A message you needed after the
 * meeting could be pinned, which announces it to the whole channel, or left to scroll
 * away. Pinning is the channel's memory; this is yours, and nobody else can see it.
 *
 * Fetched on open, like the pins panel and for the same reasons: read rarely, cheap to
 * get right at the moment it is looked at, and nothing to invalidate when a message is
 * saved somewhere else in the app. The ids live in the store — they come down on boot,
 * because the message menu has to know which label to show — but the messages do not.
 */

import { useEffect, useState } from 'react';
import type { Message } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { showMessage } from '../../lib/navigation.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { PinIcon } from '../../components/Icon.tsx';
import { formatRelative } from './messageFormatting.ts';

export function SavedView() {
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const savedMessageIds = useStore((s) => s.savedMessageIds);
  const toggleSaved = useStore((s) => s.toggleSaved);
  const channelTitle = useStore((s) => s.channelTitle);

  const [messages, setMessages] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.messages
      .saved()
      .then((r) => {
        if (!cancelled) setMessages(r.messages);
      })
      .catch(() => {
        if (!cancelled) setError('Those could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Removed from the list here rather than refetched. The server has already forgotten
  // it, and a list that reorders under the hand that just tapped it is worse than one
  // that is a moment out of date.
  const visible = (messages ?? []).filter((message) => savedMessageIds.has(message.id));

  return (
    <div className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">Later</h1>
          </div>
          <div className="pane-sub">Only you can see this</div>
        </div>
      </header>

      <div className="search-results">
        {error && <p className="error-text">{error}</p>}
        {!error && messages === null && <p className="muted">Loading…</p>}

        {messages !== null && visible.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-mark">
              <PinIcon size={19} />
            </div>
            <div className="empty-state-title">Nothing saved</div>
            <div className="empty-state-body">
              Pick <strong>Save for later</strong> from a message's ••• menu and it waits
              here. Pinning tells the channel; this tells nobody.
            </div>
          </div>
        )}

        {visible.map((message) => {
          const author = message.authorId ? users[message.authorId] : undefined;
          const channel = channels[message.channelId];
          return (
            <div key={message.id} className="search-result saved-row">
              <Avatar user={author} size="lg" />
              <button
                className="saved-body"
                type="button"
                onClick={() => void showMessage(message.id)}
              >
                <div className="search-result-head">
                  <span className="search-result-author">
                    {author?.displayName ?? 'Someone'}
                  </span>
                  <span className="search-result-meta">
                    {channel
                      ? channel.name
                        ? `#${channel.name}`
                        : channelTitle(channel)
                      : 'Unknown'}{' '}
                    · {formatRelative(message.createdAt)}
                  </span>
                </div>
                <div className="search-result-text">{message.body}</div>
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => void toggleSaved(message.id)}
                title="Remove from later"
              >
                Done
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
