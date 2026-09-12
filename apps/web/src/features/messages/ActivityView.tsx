/** Activity: who named you, and who reacted to what you wrote.
 *
 * Slack's Activity tab, and the surface Blob was missing most. A mention bumped a badge
 * on a channel and then lived nowhere you could look at it; a reaction to your message
 * left no trace at all outside the message, so somebody answering you with a ✅ in a
 * channel you had scrolled past was invisible. Both are here, newest first, and clicking
 * one takes you to where it happened.
 *
 * "New" is remembered here rather than on the server: the last time this screen was
 * opened goes into localStorage, and anything since is marked. It is a reading aid, not
 * state anybody else can see — and it costs no column, no cursor and no write.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Message } from '@blob/shared';
import { api, type ActivityItem, type ActivityKind } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { showMessage } from '../../lib/navigation.ts';
import { showError } from '../../lib/toasts.ts';
import { MentionIcon } from '../../components/Icon.tsx';
import { MessageResultRow } from './MessageResultRow.tsx';
import { EmptyState } from '../../components/EmptyState.tsx';

const SEEN_KEY = 'blob.activity.seen';

const FILTERS: Array<{ value: ActivityKind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'mention', label: 'Mentions' },
  { value: 'reaction', label: 'Reactions' },
];

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeSeen(at: string): void {
  try {
    localStorage.setItem(SEEN_KEY, at);
  } catch {
    // A private window is not a reason to fail; nothing is marked new, that is all.
  }
}

export function ActivityView({ initialKind = 'all' }: { initialKind?: ActivityKind } = {}) {
  const users = useStore((s) => s.users);
  const [kind, setKind] = useState<ActivityKind>(initialKind);
  /** Read once, on arrival: the marks must not move while the list is being read. */
  const [seenAt] = useState(readSeen);

  return (
    <main className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">Activity</h1>
          </div>
          <div className="pane-sub">Mentions of you, and reactions to what you wrote</div>
        </div>
      </header>

      <div className="chip-row" style={{ padding: '0 16px 8px' }}>
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            className="chip"
            type="button"
            aria-pressed={kind === filter.value}
            onClick={() => setKind(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <ActivityResults key={kind} kind={kind} seenAt={seenAt} users={users} />
    </main>
  );
}

function ActivityResults({
  kind,
  seenAt,
  users,
}: {
  kind: ActivityKind;
  seenAt: string;
  users: ReturnType<typeof useStore.getState>['users'];
}) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void api.activity
      .list(kind)
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
        // The newest thing on screen is what "seen" now means. Written after the list
        // arrives, so a failed request never marks anything read.
        if (page.items.length > 0) writeSeen(page.items[0]!.at);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [kind]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await api.activity.list(kind, nextCursor);
      setItems((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      // Keep what is already on screen; losing the list because the next page failed is
      // a worse answer than a button that did nothing.
      showError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  const rows = useMemo(
    () =>
      (items ?? []).map((item) => ({
        item,
        key: `${item.kind}:${item.message.id}:${item.actorId ?? ''}:${item.emoji ?? ''}`,
        isNew: seenAt === '' ? false : item.at > seenAt,
      })),
    [items, seenAt],
  );

  async function go(message: Message) {
    const shown = await showMessage(message.id);
    if (!shown) showError(new Error('That message is no longer there.'));
  }

  return (
    <div className="search-results">
      {failed && <p className="error-text">That could not be loaded.</p>}
      {!failed && items === null && <p className="muted">Loading…</p>}

      {items?.length === 0 && (
        <EmptyState mark={<MentionIcon size="xl" />} title="Nothing yet">
          When somebody names you or reacts to something you wrote, it shows up here
          — so you can find your way back to it without hunting through channels.
        </EmptyState>
      )}

      {rows.map(({ item, key, isNew }) => (
        <MessageResultRow
          key={key}
          message={item.message}
          timestamp={item.at}
          onOpen={() => void go(item.message)}
          footer={
            <div className="search-result-meta">
              {item.kind === 'reaction' ? (
                <>
                  <span className="activity-emoji" aria-hidden="true">
                    {item.emoji}
                  </span>{' '}
                  {item.actorId ? (users[item.actorId]?.displayName ?? 'Someone') : 'Someone'}{' '}
                  reacted to this
                </>
              ) : (
                <>
                  {item.actorId ? (users[item.actorId]?.displayName ?? 'Someone') : 'Someone'}{' '}
                  mentioned you
                </>
              )}
              {isNew && <span className="thread-new">New</span>}
            </div>
          }
        />
      ))}

      {nextCursor && (
        <div style={{ padding: 12 }}>
          <button className="btn" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        </div>
      )}
    </div>
  );
}
