/**
 * ⌘K quick switcher.
 *
 * Channels, people and a few verbs in one fuzzy-matched list — the single most-used
 * navigation control in every chat app worth copying, which is why it ships in the
 * first release rather than as polish later.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { showError } from "../../lib/toasts.ts";
import { useStore } from "../../lib/store.ts";
import { showChannel, showMessage } from "../../lib/navigation.ts";
import { navigate, pathForRoute } from "../../lib/router.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { Dialog } from "../../components/Dialog.tsx";

interface Item {
  id: string;
  label: string;
  kind: "Channel" | "Person" | "Action" | "Message";
  hint?: string;
  run: () => void | Promise<void>;
}

/** A body on one line, so a result is one row whatever was typed into it. */
function oneLine(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

export function CommandPalette({
  onClose,
  only,
}: {
  onClose: () => void;
  /**
   * Narrow the list to one kind of thing.
   *
   * ⌘⇧K in Slack means "direct messages", and the answer to it is the same picker with
   * the channels and the verbs taken out — not a second component that would drift from
   * this one the first time either changed.
   */
  only?: "people";
}) {
  const channels = useStore((s) => s.channels);
  const users = useStore((s) => s.users);
  const currentUser = useStore((s) => s.currentUser);
  const setPrefs = useStore((s) => s.setPrefs);
  const channelTitle = useStore((s) => s.channelTitle);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [found, setFound] = useState<{ messages: Message[]; total: number }>({
    messages: [],
    total: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /**
   * What was *said*, not just where to go.
   *
   * The palette used to offer "Search messages…" as an action that navigated away, so
   * ⌘K could tell you a channel existed and never what was in it — and the bar's search
   * button left the conversation to answer a question about it. One surface finds
   * anything now; `/search` stays for a shareable link and for paging through a long
   * result, which a popup should not try to be.
   *
   * Debounced, because search is rate limited server-side and a palette is typed into
   * quickly. `live` is the part worth keeping: without it an earlier, slower response
   * can land after a later one and leave the list showing results for a prefix of what
   * is in the box — the race every search field gets wrong once.
   */
  useEffect(() => {
    const q = query.trim();
    if (only === "people" || q.length < 2) {
      setFound({ messages: [], total: 0 });
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void api
        .search(q)
        .then((result) => {
          if (live) setFound({ messages: result.messages, total: result.total });
        })
        .catch(() => {
          // A failed search must not take the jump list down with it: the palette's
          // first job still works offline, and a toast over a popup is noise.
          if (live) setFound({ messages: [], total: 0 });
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, only]);

  const items = useMemo<Item[]>(() => {
    const channelItems: Item[] = Object.values(channels)
      .filter((c) => !c.archivedAt)
      .map((channel) => ({
        id: `c-${channel.id}`,
        label: channel.name ? `#${channel.name}` : channelTitle(channel),
        kind: "Channel",
        hint: channel.membership ? undefined : "not joined",
        run: async () => {
          if (!channel.membership && channel.kind === "public") {
            const { channel: joined } = await api.channels.join(channel.id);
            useStore.setState((s) => ({
              channels: { ...s.channels, [joined.id]: joined },
            }));
          }
          await showChannel(channel.id);
        },
      }));

    const peopleItems: Item[] = Object.values(users)
      .filter((u) => !u.deactivated && u.id !== currentUser?.id)
      .map((person) => ({
        id: `u-${person.id}`,
        label: person.displayName,
        kind: "Person",
        run: async () => {
          const { channel } = await api.dms.open([person.id]);
          useStore.setState((s) => ({
            channels: { ...s.channels, [channel.id]: channel },
          }));
          await showChannel(channel.id);
        },
      }));

    const theme = currentUser?.prefs.theme ?? "system";
    const density = currentUser?.prefs.density ?? "comfortable";
    const actionItems: Item[] = [
      {
        id: "a-home",
        label: "Home — what needs you",
        kind: "Action",
        run: () => navigate("/"),
      },
      {
        id: "a-theme",
        label:
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        kind: "Action",
        run: () => setPrefs({ theme: theme === "dark" ? "light" : "dark" }),
      },
      {
        id: "a-browse",
        label: "Browse channels…",
        kind: "Action",
        run: () => navigate("/channels"),
      },
      {
        // The sidebar used to carry a labelled "Search {workspace}" button. The bar's
        // Search button and ⌘F both still reach the same place, but somebody who
        // reaches for ⌘K first should find message search there rather than learn that
        // the palette only jumps to channels and people.
        id: "a-search",
        label: "Search messages…",
        kind: "Action",
        run: () => navigate("/search"),
      },
      {
        // The guide is a page somebody looks for exactly when they do not know where
        // anything is, which is the one moment a buried menu row is hardest to find.
        id: "a-help",
        label: "Help — how Blob works",
        kind: "Action",
        run: () => navigate("/help"),
      },
      {
        id: "a-catchup",
        label: "Catch me up — summarise what I haven't read",
        kind: "Action",
        run: () => useStore.setState({ catchupScope: "all" }),
      },
      {
        id: "a-density",
        label:
          density === "compact"
            ? "Use comfortable density"
            : "Use compact density",
        kind: "Action",
        run: () =>
          setPrefs({
            density: density === "compact" ? "comfortable" : "compact",
          }),
      },
    ];

    if (only === "people") return peopleItems;
    return [...channelItems, ...peopleItems, ...actionItems];
  }, [channels, users, currentUser, setPrefs, channelTitle, only]);

  const messageItems = useMemo<Item[]>(
    () =>
      found.messages.slice(0, 6).map((message) => {
        const channel = channels[message.channelId];
        const where = channel
          ? channel.name
            ? `#${channel.name}`
            : channelTitle(channel)
          : "a conversation";
        return {
          id: `m-${message.id}`,
          label: oneLine(message.body) || "(no text)",
          kind: "Message",
          hint: `${(message.authorId ? users[message.authorId]?.displayName : null) ?? "Someone"} · ${where}`,
          run: async () => {
            await showMessage(message.id);
          },
        };
      }),
    [found.messages, channels, users, channelTitle],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^[#@]/, "");
    if (!q) return items.slice(0, 12);
    // Jumping stays first and stays fast — it is what the key is reached for, and it
    // answers while the search request is still in the air. Messages take the room
    // below rather than competing for the same twelve slots.
    const jump = items
      .map((item) => ({ item, score: score(item.label.toLowerCase(), q) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, messageItems.length > 0 ? 6 : 12)
      .map((entry) => entry.item);

    const all = [...jump, ...messageItems];
    if (found.total > messageItems.length) {
      all.push({
        id: "m-all",
        label: `See all ${found.total} results for “${query.trim()}”`,
        kind: "Action",
        // The page, not the popup: modifiers, sorting and paging live there, and the
        // URL is the thing somebody sends to a colleague.
        run: () => navigate(pathForRoute({ view: "search", query: query.trim() })),
      });
    }
    return all;
  }, [items, query, messageItems, found.total]);

  // Results arrive after the list was already drawn, so the highlight can end up past
  // the end of it. Enter would then do nothing at all, which reads as a broken palette.
  useEffect(() => {
    if (index >= matches.length) setIndex(0);
  }, [matches.length, index]);

  async function choose(item: Item | undefined) {
    if (!item) return;
    onClose();
    // The palette is gone by the time the action settles; a failure after this line
    // has no UI left to land in except a toast.
    // Channels and people go through `showChannel`, which navigates. That used to be a
    // special case here — the palette was the only place that had noticed opening a
    // channel from another view changed what was behind it and nothing else. The
    // sidebar and the search results had the same bug and no such line.
    try {
      await item.run();
    } catch (err) {
      showError(err);
    }
  }

  // The backdrop is presentational. It was role="button" tabIndex={0}, which put a tab
  // stop announced as a button in front of the dialog and answered Space by closing it.
  // Clicking a backdrop is a pointer shortcut; the keyboard path is Escape, bound above.
  return (
    <Dialog label={only === "people" ? "Message someone" : "Jump to"} onClose={onClose} className="palette-host">
      <div className="palette">
        {/*
         * The combobox pattern, because focus never leaves this input.
         *
         * Arrowing moved a highlight that only existed in CSS: focus stayed here, so a
         * screen reader had nothing to announce and no way to say what Enter would do.
         * `aria-activedescendant` is what makes a moving selection audible while the
         * focused element does not change — without it ⌘K, the main way to get anywhere
         * in this app, is a text box that silently swallows arrow keys.
         */}
        <input
          ref={inputRef}
          className="palette-input"
          value={query}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls="palette-results"
          aria-autocomplete="list"
          aria-activedescendant={
            matches.length > 0 ? `palette-option-${index}` : undefined
          }
          placeholder={
            only === "people"
              ? "Message someone…"
              : "Search everything — channels, people, messages…"
          }
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((i) => (i + 1) % Math.max(matches.length, 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex(
                (i) => (i - 1 + matches.length) % Math.max(matches.length, 1),
              );
            } else if (event.key === "Enter") {
              event.preventDefault();
              void choose(matches[index]);
            }
          }}
        />

        <div className="palette-results" id="palette-results" role="listbox">
          {matches.length === 0 ? (
            <div className="palette-empty">Nothing matched “{query}”</div>
          ) : (
            matches.map((item, i) => (
              <button
                key={item.id}
                id={`palette-option-${i}`}
                role="option"
                aria-selected={i === index}
                className="palette-item"
                data-active={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => void choose(item)}
              >
                {item.kind === "Person" && (
                  <Avatar
                    user={{ displayName: item.label, avatarUrl: null }}
                    size="sm"
                  />
                )}
                <span className="palette-item-label">{item.label}</span>
                {item.hint && <span className="palette-item-hint muted">{item.hint}</span>}
                <span className="palette-item-kind">{item.kind}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
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
