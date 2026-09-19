/**
 * ⌘K quick switcher.
 *
 * Channels, people and a few verbs in one fuzzy-matched list — the single most-used
 * navigation control in every chat app worth copying, which is why it ships in the
 * first release rather than as polish later.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { showError } from "../../lib/toasts.ts";
import { useStore } from "../../lib/store.ts";
import {
  showChannelFromResult,
  showDirectMessage,
  showMessage,
} from "../../lib/navigation.ts";
import { navigate } from "../../lib/router.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { Dialog } from "../../components/Dialog.tsx";

/** The sections, in the order they are drawn — which is also the order Tab walks. */
type Section = "Channels" | "People" | "Messages" | "Files" | "Actions";

const SCOPES = ["all", "channels", "people", "messages", "files"] as const;
type PaletteScope = (typeof SCOPES)[number];

/** What the input's accessible name says it is searching. */
const SCOPE_LABEL: Record<PaletteScope, string> = {
  all: "everything",
  channels: "channels",
  people: "people",
  messages: "messages",
  files: "files",
};

/**
 * The one section a narrowed scope draws, or null for "draw them all".
 *
 * One table rather than two: the same answer decides which request goes out and which
 * rows are kept, so a scope that stopped fetching but kept rendering cannot happen.
 */
const SCOPE_SECTION: Record<PaletteScope, Section | null> = {
  all: null,
  channels: "Channels",
  people: "People",
  messages: "Messages",
  files: "Files",
};

/**
 * How many rows a section gets: twelve when it owns the list, five when it shares it.
 *
 * A section that fetches asks for one more than it will draw, which is how "there is
 * more" is known without a count — so both numbers come from here and the +1 cannot
 * drift away from the budget it is one more than.
 */
const ROOM = { sole: 12, shared: 5 } as const;

/** Whether a section's own request should go out at all. */
function fetches(scope: PaletteScope, section: Section): boolean {
  const sole = SCOPE_SECTION[scope];
  return sole === null || sole === section;
}

interface Item {
  id: string;
  label: string;
  kind: "Channel" | "Person" | "Action" | "Message" | "File";
  section: Section;
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
  const [scope, setScope] = useState<PaletteScope>("all");
  const [found, setFound] = useState<{ messages: Message[]; total: number }>({
    messages: [],
    total: 0,
  });
  const [files, setFiles] = useState<FileEntry[]>([]);
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
    if (only === "people" || q.length < 2 || !fetches(scope, "Messages")) {
      return undefined;
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
  }, [query, only, scope]);

  /** Files by name. One more than is shown, so "there is more" needs no count. */
  useEffect(() => {
    const q = query.trim();
    if (only === "people" || q.length < 2 || !fetches(scope, "Files")) {
      return undefined;
    }
    let live = true;
    const wanted = (scope === "files" ? ROOM.sole : ROOM.shared) + 1;
    const timer = setTimeout(() => {
      void api.files
        .list({ q, limit: wanted })
        .then((result) => {
          if (live) setFiles(result.items);
        })
        .catch(() => {
          if (live) setFiles([]);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, only, scope]);

  const channelItems = useMemo<Item[]>(
    () =>
      Object.values(channels)
        .filter((c) => !c.archivedAt)
        .map((channel) => {
          const joined = channel.membership !== null;
          return {
            id: `c-${channel.id}`,
            label: channel.name ? `#${channel.name}` : channelTitle(channel),
            kind: "Channel",
            section: "Channels",
            hint: joined ? undefined : "not joined",
            run: () => showChannelFromResult(channel.id, { joined, kind: channel.kind }),
          };
        }),
    [channels, channelTitle],
  );

  const peopleItems = useMemo<Item[]>(
    () =>
      Object.values(users)
        .filter((u) => !u.deactivated && u.id !== currentUser?.id)
        .map((person) => ({
          id: `u-${person.id}`,
          label: person.displayName,
          kind: "Person",
          section: "People",
          run: () => showDirectMessage(person.id),
        })),
    [users, currentUser],
  );

  const actionItems = useMemo<Item[]>(() => {
    const theme = currentUser?.prefs.theme ?? "system";
    const density = currentUser?.prefs.density ?? "comfortable";
    return [
      {
        id: "a-home",
        label: "Home — what needs you",
        kind: "Action",
        section: "Actions",
        run: () => navigate("/"),
      },
      {
        id: "a-theme",
        label:
          theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        kind: "Action",
        section: "Actions",
        run: () => setPrefs({ theme: theme === "dark" ? "light" : "dark" }),
      },
      {
        id: "a-browse",
        label: "Browse channels…",
        kind: "Action",
        section: "Actions",
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
        section: "Actions",
        run: () => navigate("/search"),
      },
      {
        // The guide is a page somebody looks for exactly when they do not know where
        // anything is, which is the one moment a buried menu row is hardest to find.
        id: "a-help",
        label: "Help — how Blob works",
        kind: "Action",
        section: "Actions",
        run: () => navigate("/help"),
      },
      {
        id: "a-catchup",
        label: "Catch me up — summarise what I haven't read",
        kind: "Action",
        section: "Actions",
        run: () => useStore.setState({ catchupScope: "all" }),
      },
      {
        id: "a-density",
        label:
          density === "compact"
            ? "Use comfortable density"
            : "Use compact density",
        kind: "Action",
        section: "Actions",
        run: () =>
          setPrefs({
            density: density === "compact" ? "comfortable" : "compact",
          }),
      },
    ];
  }, [currentUser, setPrefs]);

  const messageItems = useMemo<Item[]>(
    () =>
      found.messages.slice(0, ROOM.sole + 1).map((message) => {
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
          section: "Messages",
          hint: `${(message.authorId ? users[message.authorId]?.displayName : null) ?? "Someone"} · ${where}`,
          run: async () => {
            await showMessage(message.id);
          },
        };
      }),
    [found.messages, channels, users, channelTitle],
  );

  const fileItems = useMemo<Item[]>(
    () =>
      files.map((entry) => {
        const channel = channels[entry.channelId];
        const where = channel
          ? channel.name
            ? `#${channel.name}`
            : channelTitle(channel)
          : "a conversation";
        return {
          id: `f-${entry.id}`,
          label: entry.filename,
          kind: "File",
          section: "Files",
          hint: where,
          run: async () => {
            // The file is not the destination — the message that carries it is, which is
            // where it can be read in the conversation it was posted into.
            await showMessage(entry.messageId);
          },
        };
      }),
    [files, channels, channelTitle],
  );

  const matches = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase().replace(/^[#@]/, "");
    // The one section this list is showing, or null for all of them. A people picker is
    // the same thing arrived at differently: it opened narrowed, and Tab cannot widen it.
    const sole: Section | null =
      only === "people" ? "People" : SCOPE_SECTION[scope];
    const wanted = (section: Section) => sole === null || section === sole;
    // A section sharing the list gets a way to see the rest; a section that owns the
    // list gets the twelve rows the flat list always had.
    const room = sole === null ? ROOM.shared : ROOM.sole;

    if (!q) {
      // With nothing typed this is still the jump list it has always been.
      return [...channelItems, ...peopleItems, ...actionItems]
        .filter((item) => wanted(item.section))
        .slice(0, 12);
    }

    const rank = (list: Item[]) =>
      list
        .map((item) => ({ item, s: score(item.label.toLowerCase(), q) }))
        .filter((entry) => entry.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((entry) => entry.item);

    const out: Item[] = [];
    const seeAll = (section: Section, label: string, target: string): Item => ({
      id: `see-${section}`,
      label,
      kind: "Action",
      section,
      // The page, not the popup: modifiers, sorting and paging live there, and the URL
      // is the thing somebody sends to a colleague.
      run: () => navigate(target),
    });
    const term = encodeURIComponent(query.trim());

    if (wanted("Channels")) {
      const all = rank(channelItems);
      const shown = all.slice(0, room);
      out.push(...shown);
      if (all.length > shown.length) {
        out.push(
          seeAll(
            "Channels",
            `See all ${all.length} channels`,
            `/search?q=${term}&scope=channels`,
          ),
        );
      }
    }
    if (wanted("People")) {
      const all = rank(peopleItems);
      const shown = all.slice(0, room);
      out.push(...shown);
      if (all.length > shown.length) {
        out.push(
          seeAll(
            "People",
            `See all ${all.length} people`,
            `/search?q=${term}&scope=people`,
          ),
        );
      }
    }
    if (wanted("Messages")) {
      // Server-ranked: never re-sorted here, or the palette would disagree with /search.
      const shown = messageItems.slice(0, room);
      out.push(...shown);
      if (found.total > shown.length) {
        out.push(
          seeAll(
            "Messages",
            `See all ${found.total} results for “${query.trim()}”`,
            `/search?q=${term}`,
          ),
        );
      }
    }
    if (wanted("Files")) {
      const shown = fileItems.slice(0, room);
      out.push(...shown);
      // No count: /api/attachments is keyset-paged and returns no total, so the row asks
      // for one more than it shows and says "more" rather than inventing a number.
      if (fileItems.length > shown.length) {
        out.push(
          seeAll(
            "Files",
            `See all files matching “${query.trim()}”`,
            `/search?q=${term}&scope=files`,
          ),
        );
      }
    }
    if (wanted("Actions")) out.push(...rank(actionItems).slice(0, ROOM.shared));

    return out;
  }, [
    query,
    scope,
    only,
    channelItems,
    peopleItems,
    actionItems,
    messageItems,
    fileItems,
    found.total,
  ]);

  // Results arrive after the list was already drawn, so the highlight can end up past
  // the end of it. Derive a valid index instead of spending another render correcting it.
  const activeIndex = index < matches.length ? index : 0;

  /** Walk the scope ring. Shift walks it backwards, so it is not a one-way trip. */
  function stepScope(backwards: boolean) {
    setIndex(0);
    setFound({ messages: [], total: 0 });
    setFiles([]);
    setScope((current) => {
      const at = SCOPES.indexOf(current);
      const next = backwards ? at - 1 + SCOPES.length : at + 1;
      return SCOPES[next % SCOPES.length]!;
    });
  }

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
        <div className="palette-field">
          <input
            ref={inputRef}
            className="palette-input"
            value={query}
            role="combobox"
            aria-label={
              only === "people"
                ? "Message someone"
                : `Search ${SCOPE_LABEL[scope]} — Tab changes what is searched`
            }
            aria-expanded={matches.length > 0}
            aria-controls="palette-results"
            aria-autocomplete="list"
            aria-activedescendant={
              matches.length > 0 ? `palette-option-${activeIndex}` : undefined
            }
            placeholder={
              only === "people"
                ? "Message someone…"
                : "Search everything — channels, people, messages…"
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
              setFound({ messages: [], total: 0 });
              setFiles([]);
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
                void choose(matches[activeIndex]);
              } else if (event.key === "Tab" && !only) {
                // Tab is the scope key here, not a focus key. This is a combobox: focus
                // never leaves the input, and the options are not tab stops (tabIndex -1
                // below), so nothing is taken away by claiming it.
                event.preventDefault();
                stepScope(event.shiftKey);
              }
            }}
          />
          {!only && (
            /* A phone has no Tab key, so the indicator is also the control. */
            <button
              type="button"
              className="chip palette-scope"
              // Touch is the platform this button exists for, and a tap that moved focus
              // off the input would drop the on-screen keyboard mid-search. Preventing
              // mousedown's default is what keeps focus where it already is; the click
              // still lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => stepScope(false)}
              // The visible text is a glyph and a noun; the name says it is a control.
              aria-label={`Searching ${SCOPE_LABEL[scope]} — change what is searched`}
            >
              ⇥ {SCOPE_LABEL[scope]}
            </button>
          )}
        </div>

        <div className="palette-results" id="palette-results" role="listbox">
          {matches.length === 0 ? (
            <div className="palette-empty">
              {/* Messages and files only exist once something has been asked for, so an
                  empty box there has matched nothing rather than failed to. Channels and
                  people are already in the store, so their empty list is an answer. */}
              {!query.trim() && (scope === "messages" || scope === "files")
                ? `Type to search ${SCOPE_LABEL[scope]}`
                : `Nothing matched “${query}”`}
            </div>
          ) : (
            matches.map((item, i) => (
              <Fragment key={item.id}>
                {item.section !== matches[i - 1]?.section && (
                  /* Presentational: each row already announces its kind through the
                     badge, so the listbox stays a flat list of options. */
                  <div className="palette-section" aria-hidden="true">
                    {item.section}
                  </div>
                )}
                <button
                  id={`palette-option-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === activeIndex}
                  className="palette-item"
                  data-active={i === activeIndex}
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
              </Fragment>
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
