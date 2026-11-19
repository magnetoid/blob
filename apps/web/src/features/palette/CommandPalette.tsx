/**
 * ⌘K quick switcher.
 *
 * Channels, people and a few verbs in one fuzzy-matched list — the single most-used
 * navigation control in every chat app worth copying, which is why it ships in the
 * first release rather than as polish later.
 *
 * The list is shadcn's Command, which is cmdk: the combobox, the listbox, the moving
 * selection and what Enter does are cmdk's, and what is in the list — the ranking, the two
 * requests, the sections and their budgets — is this file's, so cmdk's own filter is off.
 * cmdk is not first-load code: this module is a chunk of its own, fetched beside the
 * overlay chunk once the page is idle (`lazyPalette.ts`), and Workspace draws it from
 * there. It still opens inside Blob's `Dialog`, which keeps it on the shared Escape stack.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useCommandState } from "cmdk";
import { cn } from "cn";
import type { ChannelWithState, FileEntry, Message } from "@blob/shared";
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
import { Button } from "../../components/ui/button.tsx";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../../components/ui/command.tsx";
import {
  FileIcon,
  LockIcon,
  MembersIcon,
  MessagesIcon,
  SparkIcon,
} from "../../components/Icon.tsx";

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
  /** What a query is matched against. A channel's carries its `#`, which is what people
   *  type; `display`, when there is one, is what the row shows beside its mark. */
  label: string;
  display?: string;
  /** A conversation's mark in the icon column: `#`, a lock for a private channel, or
   *  people for a group message. */
  mark?: "hash" | "lock" | "group";
  kind:
    | "Channel"
    | "Direct message"
    | "Group message"
    | "Person"
    | "Agent"
    | "Action"
    | "Message"
    | "File";
  /** A person's picture, when they have one. */
  avatarUrl?: string | null;
  section: Section;
  hint?: string;
  run: () => void | Promise<void>;
}

/** A body on one line, so a result is one row whatever was typed into it. */
function oneLine(body: string): string {
  return body.replace(/\s+/g, " ").trim();
}

/** Actions a guest has no use for: they browse no channels and use no agents (ADR 0034). */
const GUEST_HIDDEN = new Set(["a-browse", "a-agents"]);

/**
 * The dialog's host, which places the shell (`components/overlays/DialogImpl.tsx`): near
 * the top rather than centred, since a palette is typed into and the eye starts high; and
 * still, since it is opened dozens of times a day from the keyboard, and a launcher that
 * makes you wait is a launcher you stop reaching for.
 */
const HOST = "[--dialog-top:12vh] [--dialog-enter:0s]";

/** The card: shadcn's Command at the palette's width, raised by Blob's top elevation —
 *  which carries its own ring, so the card sets no border. */
const CARD = "h-auto max-h-[60vh] w-[min(560px,calc(100vw-32px))] shadow-(--elev-3)";

/** A key, drawn as shadcn's Kbd draws one. */
const KBD =
  "pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none";

/** Enter, on the selected row only; a phone has no Enter key to show. */
const ENTER = cn(
  KBD,
  "invisible ml-0 tracking-normal group-data-selected/command-item:visible group-data-selected/command-item:bg-background pointer-coarse:hidden",
);

/** The footer's key hints. Under a finger there are no keys to describe. */
const FOOTER =
  "-mx-1 -mb-1 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-3 py-2 text-xs text-muted-foreground pointer-coarse:hidden";

/** The scope control: no give when pressed and no fade, as nothing in the palette moves.
 *  Its 44px under a coarse pointer is the Button's own. */
const SCOPE = "transition-none active:not-aria-[haspopup]:translate-y-0";

/** The icon column, 20px like the face a person's row carries in it. */
const MARK = "grid size-5 flex-none place-items-center rounded-md text-xs leading-none font-bold";
/** A glyph's tile, lifted off the selected row's wash so it stays a tile. */
const MARK_GLYPH = "bg-muted text-muted-foreground group-data-selected/command-item:bg-background";
/** An action is the product's verb, and the product speaks in its accent with the ✦. */
const MARK_ACTION = "bg-(--blob-accent-wash) text-(--blob-accent)";

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
  const [scope, setScope] = useState<PaletteScope>("all");
  const [found, setFound] = useState<{ messages: Message[]; total: number }>({
    messages: [],
    total: 0,
  });
  const [files, setFiles] = useState<FileEntry[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  const me = currentUser?.id;
  const channelItems = useMemo<Item[]>(
    () =>
      Object.values(channels)
        .filter((c) => !c.archivedAt && !(c.kind === "dm" && hasPersonRow(c, users, me)))
        .map((channel) => {
          const joined = channel.membership !== null;
          const direct = channel.kind === "dm";
          const group = channel.kind === "group_dm";
          const other = direct ? otherMember(channel, me) : undefined;
          return {
            id: `c-${channel.id}`,
            label: channel.name ? `#${channel.name}` : channelTitle(channel),
            // Slack's switcher draws a channel as its mark and its name, the `#` in the
            // icon column where every other row has its icon. A group message keeps its
            // title, with the mark that says it is people rather than a channel.
            display: channel.name ?? undefined,
            mark: direct ? undefined : group ? "group" : channel.kind === "private" ? "lock" : "hash",
            kind: direct ? "Direct message" : group ? "Group message" : "Channel",
            avatarUrl: direct ? (users[other ?? me ?? ""]?.avatarUrl ?? null) : undefined,
            section: "Channels",
            hint: joined ? undefined : "not joined",
            run: () => showChannelFromResult(channel.id, { joined, kind: channel.kind }),
          };
        }),
    [channels, channelTitle, users, me],
  );

  const peopleItems = useMemo<Item[]>(
    () =>
      Object.values(users)
        .filter((u) => !u.deactivated && u.id !== currentUser?.id)
        .map((person) => ({
          id: `u-${person.id}`,
          label: person.displayName,
          avatarUrl: person.avatarUrl ?? null,
          // What a message from them is badged as, so the row says the same.
          kind: person.kind === "bot" ? "Agent" : "Person",
          section: "People",
          run: () => showDirectMessage(person.id),
        })),
    [users, currentUser],
  );

  const actionItems = useMemo<Item[]>(() => {
    const theme = currentUser?.prefs.theme ?? "system";
    const density = currentUser?.prefs.density ?? "comfortable";
    const items: Item[] = [
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
        id: "a-agents",
        label: "Agents — who you can ask, and what each is doing",
        kind: "Action",
        section: "Actions",
        run: () => navigate("/agents"),
      },
      {
        id: "a-decisions",
        label: "Decisions — what the team settled, and where",
        kind: "Action",
        section: "Actions",
        run: () => navigate("/decisions"),
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
    return currentUser?.role === "guest" ? items.filter((item) => !GUEST_HIDDEN.has(item.id)) : items;
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

  /** The rows by section, in the order they were ranked: one group per run of a section. */
  const groups = useMemo(() => {
    const out: { section: Section; items: Item[] }[] = [];
    for (const item of matches) {
      const last = out[out.length - 1];
      if (last?.section === item.section) last.items.push(item);
      else out.push({ section: item.section, items: [item] });
    }
    return out;
  }, [matches]);

  /** What the combobox is called, which says what it searches and what Tab does there. */
  const name =
    only === "people"
      ? "Message someone"
      : `Search ${SCOPE_LABEL[scope]} — Tab changes what is searched`;

  /** Walk the scope ring. Shift walks it backwards, so it is not a one-way trip. */
  function stepScope(backwards: boolean) {
    setFound({ messages: [], total: 0 });
    setFiles([]);
    setScope((current) => {
      const at = SCOPES.indexOf(current);
      const next = backwards ? at - 1 + SCOPES.length : at + 1;
      return SCOPES[next % SCOPES.length]!;
    });
  }

  async function choose(item: Item) {
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

  return (
    <Dialog label={only === "people" ? "Message someone" : "Jump to"} onClose={onClose} className={HOST}>
      {/*
       * The combobox pattern, because focus never leaves the input: cmdk's, with its own
       * filter off — what is in the list, and in what order, is decided above. `loop`
       * because the arrows always wrapped here. `vimBindings` off because ⌃K opens this
       * palette — it is ⌘K's other spelling (`lib/shortcuts.ts`) — and cmdk would read it,
       * with ⌃J, ⌃N and ⌃P, as "move the selection".
       */}
      <Command shouldFilter={false} loop vimBindings={false} label={name} className={CARD}>
        <CommandInput
          ref={inputRef}
          value={query}
          // Also the input's own name: cmdk labels it by a hidden <label> holding the same
          // words (`label` above), and the two must never say different things.
          aria-label={name}
          placeholder={
            only === "people"
              ? "Message someone…"
              : "Search everything — channels, people, messages…"
          }
          onValueChange={(next) => {
            setQuery(next);
            setFound({ messages: [], total: 0 });
            setFiles([]);
          }}
          onKeyDown={(event) => {
            if (event.key === "Tab" && !only) {
              // Tab is the scope key here, not a focus key. This is a combobox: focus
              // never leaves the input, and the options are not tab stops, so nothing is
              // taken away by claiming it.
              event.preventDefault();
              stepScope(event.shiftKey);
            }
          }}
        >
          {!only && (
            /* A phone has no Tab key, so the indicator is also the control. */
            <Button
              type="button"
              variant="secondary"
              size="xs"
              className={SCOPE}
              // Touch is the platform this button exists for, and a tap that moved focus
              // off the input would drop the on-screen keyboard mid-search. Preventing
              // mousedown's default is what keeps focus where it already is; the click
              // still lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => stepScope(false)}
              // cmdk reads Enter anywhere in the palette as "open the selected row". On
              // this button it means the button.
              onKeyDown={(event) => {
                if (event.key === "Enter") event.stopPropagation();
              }}
              // The visible text is a glyph and a noun; the name says it is a control.
              aria-label={`Searching ${SCOPE_LABEL[scope]} — change what is searched`}
            >
              ⇥ {SCOPE_LABEL[scope]}
            </Button>
          )}
        </CommandInput>

        <CommandList className="max-h-none">
          <CommandEmpty className="text-muted-foreground">
            {/* Messages and files only exist once something has been asked for, so an
                empty box there has matched nothing rather than failed to. Channels and
                people are already in the store, so their empty list is an answer. */}
            {!query.trim() && (scope === "messages" || scope === "files")
              ? `Type to search ${SCOPE_LABEL[scope]}`
              : `Nothing matched “${query}”`}
          </CommandEmpty>
          {groups.map(({ section, items }) => (
            /* A section is a group with its heading, which only a section with rows has:
               a header over nothing would claim the term matched a kind of thing it did
               not. */
            <CommandGroup key={section} heading={section}>
              {items.map((item) => (
                <CommandItem key={item.id} value={item.id} onSelect={() => void choose(item)}>
                  <ItemMark item={item} />
                  <span data-part="label" className="min-w-0 truncate">
                    {item.display ?? item.label}
                  </span>
                  {item.hint && (
                    /* Who and where, which stays legible when the body is cut instead. */
                    <span data-part="hint" className="flex-none text-xs whitespace-nowrap text-muted-foreground">
                      {item.hint}
                    </span>
                  )}
                  {/* A private channel says so in words as well as with its lock: the
                      lock is decoration, and this is what a screen reader hears. */}
                  <span data-part="kind" className="ml-auto flex-none pl-2 text-xs text-muted-foreground">
                    {item.mark === "lock" ? "Private channel" : item.kind}
                  </span>
                  {/* What Enter does, on the row it would do it to. Decoration: the row's
                      selection is already what the combobox announces. It keeps its room
                      on every row, so the kind does not shift when the selection
                      arrives. */}
                  <CommandShortcut aria-hidden="true" className={ENTER}>
                    ↵
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
        <ComboboxState input={inputRef} />

        {/* The keys, where a palette's keys always are. Decoration for eyes: the input's
            name already says what Tab does, and arrows and Enter are the combobox's own.
            A phone has no keyboard to describe. */}
        <div aria-hidden="true" className={FOOTER}>
          <span className="inline-flex items-center gap-1">
            <kbd className={KBD}>↑</kbd>
            <kbd className={KBD}>↓</kbd> to move
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className={KBD}>↵</kbd> to open
          </span>
          {!only && (
            <span className="inline-flex items-center gap-1">
              <kbd className={KBD}>⇥</kbd> to narrow
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1">
            <kbd className={KBD}>esc</kbd> to close
          </span>
        </div>
      </Command>
    </Dialog>
  );
}

export default CommandPalette;

/** The other person in a direct message; none in the one with yourself. */
function otherMember(channel: ChannelWithState, me: string | undefined): string | undefined {
  return (channel.memberIds ?? []).find((id) => id !== me);
}

/**
 * A direct message is its person, who has a row of their own that opens it: listing both
 * put one conversation in the switcher twice, the second time under "Channel". The
 * conversation keeps its row when there is no such person row — the one with yourself,
 * or with somebody deactivated.
 */
function hasPersonRow(
  channel: ChannelWithState,
  users: Record<string, { deactivated?: boolean }>,
  me: string | undefined,
): boolean {
  const other = otherMember(channel, me);
  return other !== undefined && users[other] !== undefined && !users[other].deactivated;
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

/**
 * The icon column: a person's face, a channel's `#` or lock, and for the rest the kind of
 * thing it is — the ✦ the product speaks with for an action, a bubble for a message, a
 * page for a file. One 20px column for all of them, the size of the face a person's row
 * carries in it, so every label starts at the same x.
 */
function ItemMark({ item }: { item: Item }) {
  if (item.kind === "Person" || item.kind === "Agent" || item.kind === "Direct message") {
    return (
      <span data-part="mark" aria-hidden="true" className={MARK}>
        <Avatar user={{ displayName: item.label, avatarUrl: item.avatarUrl ?? null }} size="sm" />
      </span>
    );
  }
  // At the size the column draws them, which the row's own rule for a bare glyph would
  // otherwise take up to 16px.
  let glyph: React.ReactNode = null;
  if (item.mark === "hash") glyph = "#";
  else if (item.mark === "lock") glyph = <LockIcon size="sm" className="size-3.5" />;
  else if (item.mark === "group") glyph = <MembersIcon size="sm" className="size-3.5" />;
  else if (item.kind === "Action") glyph = <SparkIcon size="sm" className="size-3.5" />;
  else if (item.kind === "Message") glyph = <MessagesIcon size="sm" className="size-3.5" />;
  else if (item.kind === "File") glyph = <FileIcon size="sm" className="size-3.5" />;
  return (
    <span
      data-part="mark"
      aria-hidden="true"
      className={cn(MARK, item.kind === "Action" ? MARK_ACTION : MARK_GLYPH)}
    >
      {glyph}
    </span>
  );
}

/**
 * What the combobox says about its list, set on the input after cmdk has had its say.
 *
 * cmdk 1.1.1 spreads the props its input is given and then writes its own over them, and
 * two of those are wrong for this palette:
 *
 * - `aria-expanded` is always `true`, so an empty list was announced as an open popup.
 * - `aria-activedescendant` is cmdk's `selectedItemId`, which it reads off the DOM in a
 *   callback that runs before the selection it has just made has been drawn whenever the
 *   selection is made for you — on opening, on every query, and when the selected row goes.
 *   So the palette opened naming no row, and a query named the row the last one had
 *   selected. Only a selection moved by a key or the pointer came out right.
 *
 * Neither can be passed in, so both are written on the node after every commit this
 * renders in: expanded while the list it controls has an option, and the active
 * descendant whichever option is selected there. It re-renders whenever the palette does —
 * which is whenever the rows change — and whenever cmdk's selection or its idea of it
 * changes, so every commit in which React could have written cmdk's values is followed by
 * this. Between those React leaves both attributes alone: it writes a prop only when it
 * changes.
 */
function ComboboxState({ input }: { input: RefObject<HTMLInputElement | null> }) {
  useCommandState((state) => state.value);
  useCommandState((state) => state.selectedItemId);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const list = document.getElementById(node.getAttribute("aria-controls") ?? "");
    node.setAttribute("aria-expanded", String(Boolean(list?.querySelector("[cmdk-item]"))));
    const selected = list?.querySelector('[cmdk-item][aria-selected="true"]');
    if (selected?.id) node.setAttribute("aria-activedescendant", selected.id);
    else node.removeAttribute("aria-activedescendant");
  });
  return null;
}
