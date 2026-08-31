/** Threads you are in, newest reply first.
 *
 * `GET /api/threads` has existed the whole time, and `threads_for_user` is written for
 * exactly this — it joins `thread_subscriptions`, honours `muted`, and orders by
 * `last_reply_at`. Its docstring calls it "the sidebar's Threads view". There was no
 * such view: `api.messages.threads()` was called by nothing, so a reply to a thread in
 * a channel you had scrolled past was findable only by scrolling back to it.
 *
 * A list rather than Slack's inline reader. Slack renders each thread with its replies
 * and a composer in place; that needs a second message list with its own paging and
 * outbox overlay, and this needs neither to be worth having. Clicking takes you to the
 * thread where it lives, which is where you were going anyway.
 */

import type { Message } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { showThread } from '../../lib/navigation.ts';
import { ReplyIcon } from '../../components/Icon.tsx';
import { MessageResultRow } from './MessageResultRow.tsx';

export function ThreadsView() {
  // Fetched on arrival, not held in the store. The list is a query over subscriptions
  // ordered by last reply, so keeping it fresh would mean recomputing that order on
  // every `message.new` in every thread anyone is in — for a screen nobody is looking
  // at. Opening it is the moment it needs to be right.
  const { data: threads, error } = useFetch(
    async () => (await api.messages.threads()).messages,
    [],
  );

  async function go(message: Message) {
    // Channel first: the thread panel renders beside the conversation, so opening the
    // thread without its channel would put a panel next to somebody else's channel.
    await showThread(message.channelId, message.id);
  }

  return (
    <main className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">Threads</h1>
          </div>
          <div className="pane-sub">Conversations you started or replied to</div>
        </div>
      </header>

      <div className="search-results">
        {error && <p className="error-text">Those could not be loaded.</p>}
        {!error && threads === null && <p className="muted">Loading…</p>}

        {threads?.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-mark">
              <ReplyIcon size={19} />
            </div>
            <div className="empty-state-title">No threads yet</div>
            <div className="empty-state-body">
              Reply in a thread and it shows up here, so you can find your way back
              without hunting for the message.
            </div>
          </div>
        )}

        {threads?.map((message) => (
          <MessageResultRow
            key={message.id}
            message={message}
            timestamp={message.lastReplyAt}
            onOpen={() => void go(message)}
            footer={
              <div className="search-result-meta">
                {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
              </div>
            }
          />
        ))}
      </div>
    </main>
  );
}
