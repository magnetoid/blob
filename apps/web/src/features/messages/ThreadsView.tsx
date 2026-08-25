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

import { useEffect, useState } from 'react';
import type { Message } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { navigate } from '../../lib/router.ts';
import { Avatar } from '../../components/Avatar.tsx';
import { ReplyIcon } from '../../components/Icon.tsx';
import { formatRelative } from './messageFormatting.ts';

export function ThreadsView() {
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const openChannel = useStore((s) => s.openChannel);
  const openThread = useStore((s) => s.openThread);
  const channelTitle = useStore((s) => s.channelTitle);

  const [threads, setThreads] = useState<Message[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetched on arrival, not held in the store. The list is a query over subscriptions
  // ordered by last reply, so keeping it fresh would mean recomputing that order on
  // every `message.new` in every thread anyone is in — for a screen nobody is looking
  // at. Opening it is the moment it needs to be right.
  useEffect(() => {
    let cancelled = false;
    void api.messages
      .threads()
      .then((r) => {
        if (!cancelled) setThreads(r.messages);
      })
      .catch(() => {
        if (!cancelled) setError('Those could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function go(message: Message) {
    // Channel first: the thread panel renders beside the conversation, so opening the
    // thread without its channel would put a panel next to somebody else's channel.
    await openChannel(message.channelId);
    await openThread(message.id);
    navigate('/');
  }

  return (
    <div className="pane">
      <header className="pane-header">
        <div style={{ minWidth: 0 }}>
          <div className="pane-heading">
            <h1 className="pane-title">Threads</h1>
          </div>
          <div className="pane-sub">Conversations you started or replied to</div>
        </div>
      </header>

      <div className="search-results">
        {error && <p className="error-text">{error}</p>}
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

        {threads?.map((message) => {
          const author = message.authorId ? users[message.authorId] : undefined;
          const channel = channels[message.channelId];
          return (
            <button
              key={message.id}
              className="search-result"
              type="button"
              onClick={() => void go(message)}
            >
              <Avatar user={author} size="lg" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="search-result-head">
                  <span className="search-result-author">
                    {author?.displayName ?? 'Someone'}
                  </span>
                  <span className="search-result-meta">
                    {channel
                      ? channel.name
                        ? `#${channel.name}`
                        : channelTitle(channel)
                      : 'Unknown'}
                    {message.lastReplyAt && ` · ${formatRelative(message.lastReplyAt)}`}
                  </span>
                </div>
                <div className="search-result-text">{message.body}</div>
                <div className="search-result-meta">
                  {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
