/**
 * ⌘K quick switcher.
 *
 * Channels, people and a few verbs in one fuzzy-matched list — the single most-used
 * navigation control in every chat app worth copying, which is why it ships in the
 * first release rather than as polish later.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../lib/api.ts';
import { navigate } from '../../lib/router.ts';
import { useStore } from '../../lib/store.ts';
import { Avatar } from '../../components/Avatar.tsx';

interface Item {
  id: string;
  label: string;
  kind: 'Channel' | 'Person' | 'Action';
  hint?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const openChannel = useStore((s) => s.openChannel);
  const setPrefs = useStore((s) => s.setPrefs);
  const channelTitle = useStore((s) => s.channelTitle);

  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<Item[]>(() => {
    const channelItems: Item[] = Object.values(channels)
      .filter((c) => !c.archivedAt)
      .map((channel) => ({
        id: `c-${channel.id}`,
        label: channel.name ? `#${channel.name}` : channelTitle(channel),
        kind: 'Channel',
        hint: channel.membership ? undefined : 'not joined',
        run: async () => {
          if (!channel.membership && channel.kind === 'public') {
            const { channel: joined } = await api.channels.join(channel.id);
            useStore.setState((s) => ({ channels: { ...s.channels, [joined.id]: joined } }));
          }
          await openChannel(channel.id);
        },
      }));

    const peopleItems: Item[] = Object.values(users)
      .filter((u) => !u.deactivated && u.id !== currentUser?.id)
      .map((person) => ({
        id: `u-${person.id}`,
        label: person.displayName,
        kind: 'Person',
        run: async () => {
          const { channel } = await api.dms.open([person.id]);
          useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
          await openChannel(channel.id);
        },
      }));

    const theme = currentUser?.prefs.theme ?? 'system';
    const density = currentUser?.prefs.density ?? 'comfortable';
    const actionItems: Item[] = [
      {
        id: 'a-theme',
        label: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        kind: 'Action',
        run: () => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' }),
      },
      {
        id: 'a-density',
        label: density === 'compact' ? 'Use comfortable density' : 'Use compact density',
        kind: 'Action',
        run: () =>
          setPrefs({ density: density === 'compact' ? 'comfortable' : 'compact' }),
      },
    ];

    return [...channelItems, ...peopleItems, ...actionItems];
  }, [channels, users, currentUser, openChannel, setPrefs, channelTitle]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[#@]/, '');
    if (!q) return items.slice(0, 12);
    return items
      .map((item) => ({ item, score: score(item.label.toLowerCase(), q) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((entry) => entry.item);
  }, [items, query]);

  useEffect(() => setIndex(0), [query]);

  async function choose(item: Item | undefined) {
    if (!item) return;
    onClose();
    await item.run();
    // Opening a channel while the console (or search, or preferences) is on screen used
    // to change what was behind the palette and nothing else. Picking a conversation
    // means "take me to it".
    if (item.kind === 'Channel' || item.kind === 'Person') navigate('/');
  }

  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div
        className="palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Jump to"
      >
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          placeholder="Jump to a channel, a person, or an action…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setIndex((i) => (i + 1) % Math.max(matches.length, 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setIndex((i) => (i - 1 + matches.length) % Math.max(matches.length, 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              void choose(matches[index]);
            }
          }}
        />

        <div className="palette-results">
          {matches.length === 0 ? (
            <div className="palette-empty">Nothing matched “{query}”</div>
          ) : (
            matches.map((item, i) => (
              <button
                key={item.id}
                className="palette-item"
                data-active={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => void choose(item)}
              >
                {item.kind === 'Person' && (
                  <Avatar user={{ displayName: item.label, avatarUrl: null }} size="sm" />
                )}
                <span>{item.label}</span>
                {item.hint && <span className="muted">{item.hint}</span>}
                <span className="palette-item-kind">{item.kind}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/** Subsequence match: prefix hits and word starts rank above scattered letters. */
function score(text: string, query: string): number {
  if (text.startsWith(query)) return 1000 - text.length;
  const wordStart = text.split(/[\s-_]/).some((word) => word.startsWith(query));
  if (wordStart) return 800 - text.length;
  if (text.includes(query)) return 600 - text.length;

  let ti = 0;
  for (const char of query) {
    const found = text.indexOf(char, ti);
    if (found === -1) return 0;
    ti = found + 1;
  }
  return 300 - text.length;
}
