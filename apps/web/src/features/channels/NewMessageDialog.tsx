/** Start a conversation with one person, or with several.
 *
 * Two gaps in one screen. There was no "New message" control anywhere — the sidebar had
 * "New channel" and no counterpart, so starting a DM meant knowing ⌘⇧K or scrolling to a
 * name. And a group message could only be made by typing `/dm @ana @bob`: every path in
 * the client sent exactly one user id, so the feature existed on the server and nowhere
 * a person could reach it.
 *
 * The cap is the server's and is stated up front rather than discovered by being refused:
 * a group message holds eight people, counting you.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { showError } from '../../lib/toasts.ts';
import { showChannel } from '../../lib/navigation.ts';
import { useEscape } from '../../lib/useEscape.ts';
import { trapFocus } from '../../lib/focusTrap.ts';
import { Avatar } from '../../components/Avatar.tsx';

/** Including you, which is why the picker stops at seven others. */
export const MAX_DM_MEMBERS = 8;

export function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEscape(onClose);
  useEffect(() => trapFocus(dialogRef.current), []);
  // Focused on mount, the way every dialog here does it — `autoFocus` is what the lint
  // rule objects to, and a modal that opens without focus inside it is worse.
  useEffect(() => inputRef.current?.focus(), []);

  const people = useMemo(
    () =>
      Object.values(users)
        .filter((u) => u.id !== currentUser?.id && !u.deactivated)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [users, currentUser],
  );

  const q = query.trim().toLowerCase();
  const matches = people.filter(
    (person) =>
      !picked.includes(person.id) &&
      (!q ||
        person.displayName.toLowerCase().includes(q) ||
        (person.fullName ?? '').toLowerCase().includes(q)),
  );

  // Seven others plus you.
  const full = picked.length >= MAX_DM_MEMBERS - 1;

  function toggle(person: User) {
    setPicked((current) =>
      current.includes(person.id)
        ? current.filter((id) => id !== person.id)
        : full
          ? current
          : [...current, person.id],
    );
    setQuery('');
  }

  async function open() {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    try {
      const { channel } = await api.dms.open(picked);
      useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      onClose();
      await showChannel(channel.id);
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="dialog new-message"
        role="dialog"
        aria-modal="true"
        aria-label="New message"
      >
        <h2 className="dialog-title">New message</h2>

        <div className="new-message-to">
          <span className="new-message-label">To</span>
          <div className="new-message-chips">
            {picked.map((id) => {
              const person = users[id];
              if (!person) return null;
              return (
                <button
                  key={id}
                  type="button"
                  className="new-message-chip"
                  onClick={() => setPicked((c) => c.filter((x) => x !== id))}
                  aria-label={`Remove ${person.displayName}`}
                >
                  {person.displayName}
                  <span aria-hidden="true">×</span>
                </button>
              );
            })}
            <input
              ref={inputRef}
              className="new-message-input"
              placeholder={picked.length === 0 ? 'Find a person' : 'Add another'}
              aria-label="Find a person"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Backspace on an empty box takes the last name off, which is what every
                // recipient field anybody has used already does.
                if (event.key === 'Backspace' && query === '' && picked.length > 0) {
                  setPicked((c) => c.slice(0, -1));
                }
                if (event.key === 'Enter' && matches[0] && !full) toggle(matches[0]);
              }}
            />
          </div>
        </div>

        {full && (
          <p className="pref-hint">
            A group message holds {MAX_DM_MEMBERS} people, counting you. Make a channel for
            more than that.
          </p>
        )}

        <div className="new-message-list">
          {matches.slice(0, 8).map((person) => (
            <button
              key={person.id}
              type="button"
              className="new-message-person"
              disabled={full}
              onClick={() => toggle(person)}
            >
              <Avatar user={person} size="sm" />
              <span>{person.displayName}</span>
              {person.title && <span className="muted">{person.title}</span>}
            </button>
          ))}
          {matches.length === 0 && (
            <p className="muted" style={{ padding: '8px 2px' }}>
              {q ? `Nobody here matches “${query}”.` : 'Everybody is already on the list.'}
            </p>
          )}
        </div>

        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={picked.length === 0 || busy}
            onClick={() => void open()}
          >
            {picked.length > 1 ? 'Start group message' : 'Message'}
          </button>
        </div>
      </div>
    </div>
  );
}
