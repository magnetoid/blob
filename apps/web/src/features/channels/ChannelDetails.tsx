/** Who is in this channel, and what it is for.
 *
 * `GET /api/channels/:id/members` was already being called — for a count rendered next
 * to an icon, on a button that did nothing when pressed. `POST .../members` and
 * `PATCH /api/channels/:id` were called by nothing at all, so a channel's topic could
 * be set by typing `/topic` and its people could be added only by an admin, in a console
 * named after the server.
 *
 * Members are fetched when this opens rather than held in the store: the list is read
 * rarely, it is the kind of thing that goes stale quietly, and `member.joined` already
 * arrives on the socket for anyone who needs to react to it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { trapFocus } from '../../lib/focusTrap.ts';
import type { ChannelWithState } from '@blob/shared';
import { api, ApiError } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar } from '../../components/Avatar.tsx';

interface Props {
  channel: ChannelWithState;
  onClose: () => void;
  /** Hand the true count back: the header caches one, and adding somebody here is the
   *  one moment it is guaranteed to be wrong. */
  onMemberCount: (count: number) => void;
}

export function ChannelDetails({ channel, onClose, onMemberCount }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => trapFocus(dialogRef.current), []);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);

  const membershipVersion = useStore((s) => s.membershipVersion[channel.id] ?? 0);
  const [memberIds, setMemberIds] = useState<string[] | null>(null);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [savingTopic, setSavingTopic] = useState(false);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const archived = channel.archivedAt !== null;
  const topicChanged = topic.trim() !== (channel.topic ?? '');

  useEffect(() => {
    let cancelled = false;
    void api.channels
      .members(channel.id)
      .then((r) => {
        if (cancelled) return;
        setMemberIds(r.userIds);
        onMemberCount(r.userIds.length);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load who is in here.');
      });
    return () => {
      cancelled = true;
    };
  }, [channel.id, onMemberCount, membershipVersion]);

  const members = useMemo(
    () =>
      (memberIds ?? [])
        .map((id) => users[id])
        .filter((user) => user !== undefined)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [memberIds, users],
  );

  // Anyone in the workspace who is not already here. Deactivated people are left out:
  // adding one would put a name in the list that can never read it.
  const candidates = useMemo(() => {
    const inHere = new Set(memberIds ?? []);
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return Object.values(users)
      .filter((user) => !user.deactivated && !inHere.has(user.id))
      .filter((user) => user.displayName.toLowerCase().includes(needle))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 6);
  }, [users, memberIds, query]);

  async function saveTopic() {
    setSavingTopic(true);
    setError(null);
    try {
      // `channel.updated` comes back over the socket and the store applies it, so the
      // header behind this dialog changes without anything here writing to the store.
      await api.channels.update(channel.id, { topic: topic.trim() || null });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That topic did not save.');
    } finally {
      setSavingTopic(false);
    }
  }

  async function addPerson(userId: string) {
    setAdding(userId);
    setError(null);
    try {
      await api.channels.addMembers(channel.id, [userId]);
      const next = [...(memberIds ?? []), userId];
      setMemberIds(next);
      onMemberCount(next.length);
      setQuery('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add them.');
    } finally {
      setAdding(null);
    }
  }

  // The backdrop is presentational. It was role="button" tabIndex={0}, which put a tab
  // stop announced as a button in front of the dialog and answered Space by closing it.
  // Clicking a backdrop is a pointer shortcut; the keyboard path is Escape, bound above.
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`About #${channel.name}`}
      >
        <h2 className="dialog-title">#{channel.name}</h2>

        <label className="field">
          <span className="field-label">Topic</span>
          <input
            className="input"
            value={topic}
            disabled={archived}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="What belongs in here?"
            maxLength={250}
          />
        </label>
        {topicChanged && !archived && (
          <div>
            <button className="btn" onClick={() => void saveTopic()} disabled={savingTopic}>
              {savingTopic ? 'Saving…' : 'Save topic'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setTopic(channel.topic ?? '')}
              style={{ marginLeft: 8 }}
            >
              Cancel
            </button>
          </div>
        )}

        {!archived && (
          <label className="field">
            <span className="field-label">Add someone</span>
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Start typing a name"
            />
          </label>
        )}

        {candidates.length > 0 && (
          <div className="member-candidates">
            {candidates.map((person) => (
              <button
                key={person.id}
                className="member-row"
                disabled={adding !== null}
                onClick={() => void addPerson(person.id)}
              >
                <Avatar user={person} size="sm" />
                <span className="member-name">{person.displayName}</span>
                <span className="muted">{adding === person.id ? 'Adding…' : 'Add'}</span>
              </button>
            ))}
          </div>
        )}

        <h3 className="section-label" style={{ marginTop: 4 }}>
          {memberIds === null ? 'Members' : `${memberIds.length} in here`}
        </h3>
        <div className="member-list">
          {memberIds === null && <p className="muted">Loading…</p>}
          {members.map((person) => (
            <div key={person.id} className="member-row" role="listitem">
              <Avatar user={person} size="sm" />
              <span className="member-name">
                {person.displayName}
                {person.id === currentUser?.id && <span className="muted"> (you)</span>}
              </span>
              {/* Somebody's status could be set in Preferences and read nowhere. A
                  list of people is the first place it is worth anything. */}
              {(person.statusEmoji || person.statusText) && (
                <span className="muted member-status">
                  {[person.statusEmoji, person.statusText].filter(Boolean).join(' ')}
                </span>
              )}
              {person.kind === 'bot' && <span className="muted">app</span>}
            </div>
          ))}
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
