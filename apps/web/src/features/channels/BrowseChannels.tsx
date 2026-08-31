/** The channel directory.
 *
 * The sidebar listed joinable channels as a `<details>` of bare names — fine for the
 * four a demo workspace has, useless for the fifty a real one grows, where the question
 * stops being "what is called what" and becomes "what is there, who is in it, and is it
 * still alive". So: search across name, description and topic, a member count, and join
 * without leaving the list.
 *
 * Public channels only. A private channel you are not in does not appear here, because
 * its existence is the private part — the same reason opening one answers 404 rather
 * than 403.
 */

import { useEffect, useState } from 'react';
import type { BrowsableChannel } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useFetch } from '../../lib/useFetch.ts';
import { useStore } from '../../lib/store.ts';
import { showChannel } from '../../lib/navigation.ts';
import { showError } from '../../lib/toasts.ts';
import { SearchIcon } from '../../components/Icon.tsx';

export function BrowseChannels() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [archived, setArchived] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  // Typing a channel name is fast and the list is small; a short debounce keeps it from
  // asking the server once per keystroke without ever feeling like a delay.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const { data, error, reload } = useFetch(
    async () => (await api.channels.browse(debounced, archived)).channels,
    [debounced, archived],
  );

  async function join(channel: BrowsableChannel) {
    setJoining(channel.id);
    try {
      const { channel: joined } = await api.channels.join(channel.id);
      useStore.setState((s) => ({ channels: { ...s.channels, [joined.id]: joined } }));
      await showChannel(joined.id);
    } catch (err) {
      showError(err);
      setJoining(null);
    }
  }

  const channels = data ?? [];

  return (
    <main className="pane">
      <header className="pane-header">
        <div>
          <h1 className="pane-title">Channels</h1>
          <div className="pane-sub">
            {channels.length === 0 ? 'Nothing to show' : `${channels.length} channels`}
          </div>
        </div>
        <div className="pane-spacer" />
        <button
          className="chip"
          aria-pressed={archived}
          onClick={() => setArchived((on) => !on)}
        >
          Include archived
        </button>
      </header>

      <div className="browse-body">
        <div className="search-field">
          <SearchIcon size={15} strokeWidth={2} />
          <input
            name="channel-search"
            value={query}
            placeholder="Search channels"
            aria-label="Search channels"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        {error && (
          <div className="empty-state">
            <div className="empty-state-title">That didn’t load</div>
            <div className="empty-state-body">{error.message}</div>
            <button className="btn" onClick={() => void reload()}>
              Try again
            </button>
          </div>
        )}

        {!error && data && channels.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-title">
              {debounced ? `Nothing matches “${debounced}”` : 'No channels yet'}
            </div>
            <div className="empty-state-body">
              {debounced
                ? 'Try a shorter word, or part of a description.'
                : 'Public channels people create will show up here.'}
            </div>
          </div>
        )}

        <ul className="browse-list">
          {channels.map((channel) => (
            <li key={channel.id} className="browse-row">
              <div className="browse-row-main">
                <div className="browse-row-name">
                  <span className="channel-hash" aria-hidden="true">
                    #
                  </span>
                  {channel.name}
                  {channel.archivedAt && <span className="chip browse-tag">Archived</span>}
                </div>
                <div className="browse-row-meta">
                  {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
                  {/* Whichever the workspace actually filled in. Slack shows the
                      purpose here and falls back to the topic; both are "what is this
                      channel for", written in different boxes. */}
                  {channel.description || channel.topic
                    ? ` · ${channel.description || channel.topic}`
                    : ''}
                </div>
              </div>
              {channel.joined ? (
                <button className="btn btn-ghost" onClick={() => void showChannel(channel.id)}>
                  Open
                </button>
              ) : (
                <button
                  className="btn"
                  disabled={joining === channel.id}
                  onClick={() => void join(channel)}
                >
                  {joining === channel.id ? 'Joining…' : 'Join'}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
