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

import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useStore } from '../../lib/store.ts';
import { showMessage } from '../../lib/navigation.ts';
import { PinIcon } from '../../components/Icon.tsx';
import { MessageResultRow } from './MessageResultRow.tsx';

export function SavedView() {
  const savedMessageIds = useStore((s) => s.savedMessageIds);
  const toggleSaved = useStore((s) => s.toggleSaved);

  const { data: messages, error } = useFetch(
    async () => (await api.messages.saved()).messages,
    [],
  );

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
        {error && <p className="error-text">Those could not be loaded.</p>}
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

        {visible.map((message) => (
          <MessageResultRow
            key={message.id}
            message={message}
            timestamp={message.createdAt}
            onOpen={() => void showMessage(message.id)}
            action={
              <button
                className="btn btn-ghost"
                onClick={() => void toggleSaved(message.id)}
                title="Remove from later"
              >
                Done
              </button>
            }
          />
        ))}
      </div>
    </div>
  );
}
