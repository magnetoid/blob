/** Later — messages you put aside for yourself, now with states and reminders.
 *
 * The one Slack habit this app had no answer for at all, grown into Slack's (and
 * Zulip's) full shape: three states — in progress, archived, done — and an optional
 * reminder that resurfaces the message when you asked it to. Pinning is the channel's
 * memory; this is yours, and nobody else can see any of it.
 */

import { useState } from 'react';
import type { LaterItem, LaterState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useStore } from '../../lib/store.ts';
import { showMessage } from '../../lib/navigation.ts';
import { showError } from '../../lib/toasts.ts';
import { PinIcon } from '../../components/Icon.tsx';
import { MessageResultRow } from './MessageResultRow.tsx';

const TABS: Array<{ state: LaterState; label: string }> = [
  { state: 'in_progress', label: 'In progress' },
  { state: 'archived', label: 'Archived' },
  { state: 'done', label: 'Done' },
];

export function SavedView() {
  const toggleSaved = useStore((s) => s.toggleSaved);
  const [tab, setTab] = useState<LaterState>('in_progress');
  // Rows the hand just moved elsewhere, hidden without a refetch: a list that
  // reorders under the tap is worse than one a moment out of date.
  const [movedAway, setMovedAway] = useState<Set<string>>(new Set());

  const { data, error, reload } = useFetch(
    async () => (await api.later.list(tab)).items,
    [tab],
  );

  async function move(item: LaterItem, state: LaterState) {
    setMovedAway((current) => new Set(current).add(item.message.id));
    try {
      await api.later.update(item.message.id, { state });
    } catch (err) {
      showError(err);
      setMovedAway((current) => {
        const next = new Set(current);
        next.delete(item.message.id);
        return next;
      });
    }
  }

  const visible = (data ?? []).filter((item) => !movedAway.has(item.message.id));

  return (
    <main className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">Later</h1>
          </div>
          <div className="pane-sub">Only you can see this</div>
        </div>
      </header>

      <div className="later-tabs" role="tablist" aria-label="Later states">
        {TABS.map(({ state, label }) => (
          <button
            key={state}
            role="tab"
            aria-selected={tab === state}
            className="chip"
            data-active={tab === state}
            onClick={() => {
              setMovedAway(new Set());
              setTab(state);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="search-results">
        {error && <p className="error-text">Those could not be loaded.</p>}
        {!error && data === null && <p className="muted">Loading…</p>}

        {data !== null && visible.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-mark">
              <PinIcon size={19} />
            </div>
            <div className="empty-state-title">
              {tab === 'in_progress' ? 'Nothing saved' : 'Nothing here'}
            </div>
            <div className="empty-state-body">
              Pick <strong>Save for later</strong> or <strong>Remind me</strong> from a
              message's ••• menu and it waits here. Pinning tells the channel; this tells
              nobody.
            </div>
          </div>
        )}

        {visible.map((item) => (
          <MessageResultRow
            key={item.message.id}
            message={item.message}
            timestamp={item.message.createdAt}
            onOpen={() => void showMessage(item.message.id)}
            footer={
              (item.remindAt || item.note) && (
                <div className="later-meta">
                  {item.remindAt && !item.remindedAt && (
                    <span className="later-chip">
                      ⏰ {new Date(item.remindAt).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  )}
                  {item.note && <span className="later-note">{item.note}</span>}
                </div>
              )
            }
            action={
              <span className="later-actions">
                {tab !== 'done' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => void move(item, 'done')}
                    title="Mark done"
                  >
                    Done
                  </button>
                )}
                {tab === 'in_progress' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => void move(item, 'archived')}
                    title="Archive"
                  >
                    Archive
                  </button>
                )}
                {tab !== 'in_progress' && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => void move(item, 'in_progress')}
                    title="Back to in progress"
                  >
                    Restore
                  </button>
                )}
                {tab === 'done' && (
                  <button
                    className="btn btn-ghost"
                    onClick={async () => {
                      setMovedAway((c) => new Set(c).add(item.message.id));
                      try {
                        await toggleSaved(item.message.id);
                      } catch (err) {
                        showError(err);
                        void reload();
                      }
                    }}
                    title="Remove entirely"
                  >
                    Remove
                  </button>
                )}
              </span>
            }
          />
        ))}
      </div>
    </main>
  );
}
