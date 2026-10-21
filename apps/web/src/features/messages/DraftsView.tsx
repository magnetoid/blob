/** What you typed and did not send (ADR 0037) — Slack's Drafts.
 *
 * Drawn from the same map the composer writes, which arrived merged with the server's and
 * follows your other devices; so a sentence started on the phone is here on the laptop,
 * and opening it puts you back where you were typing.
 */

import { useStore } from '../../lib/store.ts';
import { parseDraftKey } from '../../lib/drafts.ts';
import { showChannel, showThread } from '../../lib/navigation.ts';
import { EmptyState } from '../../components/EmptyState.tsx';
import { DraftIcon } from '../../components/Icon.tsx';

function whenText(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function DraftsView() {
  const drafts = useStore((s) => s.drafts);
  const channels = useStore((s) => s.channels);
  const channelTitle = useStore((s) => s.channelTitle);
  const setDraft = useStore((s) => s.setDraft);

  const items = Object.entries(drafts)
    .filter(([, draft]) => draft.body.trim() !== '')
    .map(([key, draft]) => ({ key, ...parseDraftKey(key), ...draft }))
    .filter((item) => channels[item.channelId] !== undefined)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <main className="pane">
      <header className="pane-header">
        <div>
          <h1 className="pane-title">Drafts</h1>
          <div className="pane-sub">
            {items.length === 0
              ? 'Nothing unsent'
              : `${items.length} unsent, here on every device you use`}
          </div>
        </div>
      </header>

      <div className="browse-body">
        {items.length === 0 && (
          <EmptyState mark={<DraftIcon size="xl" />} title="No drafts">
            What you type and do not send waits here, and on every other device you sign in on.
          </EmptyState>
        )}

        <ul className="browse-list">
          {items.map((item) => {
            const channel = channels[item.channelId];
            const room = channel ? channelTitle(channel) : '';
            return (
              <li key={item.key} className="browse-row">
                <button
                  type="button"
                  className="browse-row-main draft-open"
                  onClick={() =>
                    void (item.threadRootId
                      ? showThread(item.channelId, item.threadRootId)
                      : showChannel(item.channelId))
                  }
                >
                  <div className="browse-row-name">
                    {item.threadRootId ? `A reply in ${room}` : room}
                    <span className="muted"> · {whenText(item.updatedAt)}</span>
                  </div>
                  <div className="browse-row-meta draft-body">{item.body}</div>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  aria-label={`Delete the draft in ${room}`}
                  onClick={() => setDraft(item.channelId, item.threadRootId, '')}
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
