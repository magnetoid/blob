/** Messages waiting to be sent.
 *
 * A schedule you cannot see is a promise you have to remember, so this is the other half
 * of the composer's clock: what is queued, when it goes, and the chance to take it back.
 * Only ever your own — a scheduled message is private until it is sent, in the same way
 * a draft is.
 */

import type { ScheduledMessage } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useStore } from '../../lib/store.ts';
import { showError } from '../../lib/toasts.ts';
import { ClockIcon } from '../../components/Icon.tsx';

function whenText(iso: string): string {
  const when = new Date(iso);
  return when.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ScheduledView() {
  const channels = useStore((s) => s.channels);
  const channelTitle = useStore((s) => s.channelTitle);
  const { data, error, reload } = useFetch(async () => (await api.scheduled.list()).scheduled, []);

  async function cancel(item: ScheduledMessage) {
    try {
      await api.scheduled.cancel(item.id);
      await reload();
    } catch (err) {
      showError(err);
    }
  }

  const items = data ?? [];

  return (
    <main className="pane">
      <header className="pane-header">
        <div>
          <h1 className="pane-title">Scheduled</h1>
          <div className="pane-sub">
            {items.length === 0 ? 'Nothing waiting' : `${items.length} waiting to send`}
          </div>
        </div>
      </header>

      <div className="browse-body">
        {error && (
          <div className="empty-state">
            <div className="empty-state-title">That didn’t load</div>
            <div className="empty-state-body">{error.message}</div>
            <button className="btn" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        )}

        {!error && data && items.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-mark" aria-hidden="true">
              <ClockIcon size="xl" />
            </div>
            <div className="empty-state-title">Nothing scheduled</div>
            <div className="empty-state-body">
              The clock beside Send puts a message aside for later.
            </div>
          </div>
        )}

        <ul className="browse-list">
          {items.map((item) => {
            const channel = channels[item.channelId];
            return (
              <li key={item.id} className="browse-row">
                <div className="browse-row-main">
                  <div className="browse-row-name">
                    {whenText(item.sendAt)}
                    <span className="muted">
                      {channel ? ` · ${channelTitle(channel)}` : ''}
                    </span>
                  </div>
                  <div className="browse-row-meta">{item.body}</div>
                  {item.lastError && (
                    <div className="error-text">Didn’t send: {item.lastError}</div>
                  )}
                </div>
                <button className="btn btn-ghost" onClick={() => void cancel(item)}>
                  Cancel
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
