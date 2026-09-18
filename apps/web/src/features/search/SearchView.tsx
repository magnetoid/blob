/**
 * Search.
 *
 * Supports the modifier grammar the server parses — `from:@name in:#channel
 * has:link before:2026-01-01` — with the free text as whatever is left over.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { navigate, pathForRoute, type SearchScope } from "../../lib/router.ts";
import type { FileEntry, Message } from "@blob/shared";
import { api, ApiError, type ParsedSearchQuery, type SearchSort } from "../../lib/api.ts";
import {
  showChannelFromResult,
  showDirectMessage,
  showMessage,
} from "../../lib/navigation.ts";
import { useStore } from "../../lib/store.ts";
import { SearchIcon } from "../../components/Icon.tsx";
import { MessageResultRow } from "../messages/MessageResultRow.tsx";
import { EmptyState } from "../../components/EmptyState.tsx";

const SORTS: Array<{ value: SearchSort; label: string }> = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'newest', label: 'Most recent' },
];

/**
 * What is being searched. A different question from FILTERS below, which are `has:`
 * shortcuts *within* a message search — so they are two rows, not one.
 */
const SCOPES: Array<{ value: SearchScope; label: string }> = [
  { value: "messages", label: "Messages" },
  { value: "files", label: "Files" },
  { value: "channels", label: "Channels" },
  { value: "people", label: "People" },
];

const FILTERS = [
  { label: "All", value: "" },
  { label: "Has file", value: "has:file" },
  { label: "Has link", value: "has:link" },
] as const;

function echoTokens(parsed: ParsedSearchQuery): string[] {
  const tokens: string[] = [];
  if (parsed.from) tokens.push(`from:@${parsed.from}`);
  if (parsed.in) tokens.push(`in:#${parsed.in}`);
  if (parsed.has) tokens.push(`has:${parsed.has}`);
  if (parsed.before) tokens.push(`before:${parsed.before}`);
  if (parsed.after) tokens.push(`after:${parsed.after}`);
  if (parsed.text) tokens.push(parsed.text);
  return tokens;
}

export function SearchView({
  initialQuery = "",
  initialScope,
}: {
  initialQuery?: string;
  initialScope?: SearchScope;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [scope, setScope] = useState<SearchScope>(initialScope ?? "messages");
  /** Filenames the server matched. Null while there is nothing to match against. */
  const [fileHits, setFileHits] = useState<FileEntry[] | null>(null);
  const people = useStore((s) => s.users);
  const me = useStore((s) => s.currentUser);
  const [filter, setFilter] = useState<string>("");
  /** Relevance answers "find the thing I remember"; recency answers "what was said
   *  about this lately". Slack offers both and people use both. */
  const [sort, setSort] = useState<SearchSort>("relevance");
  const [results, setResults] = useState<Message[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  /**
   * How the last search failed, not merely that it did.
   *
   * A 429 is not a server error, and the standing copy said it was — "the server errored
   * or couldn't be reached… adjust the query", when the server answered correctly and
   * the query is fine. Telling somebody to change what they typed when what they need to
   * do is wait is the kind of wrong answer that costs them the search.
   */
  const [failure, setFailure] = useState<"none" | "rate-limited" | "error">(
    "none",
  );
  const failed = failure !== "none";
  /** Where the results so far stopped. Null once there is nothing after them. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSearchQuery | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // The URL follows what is in the box, replacing rather than pushing: a search is one
  // place you went, not one per keystroke. This is what makes a search shareable, and
  // what makes Back leave the search rather than rewind it letter by letter.
  useEffect(() => {
    const term = query.trim();
    navigate(pathForRoute({ view: "search", query: term || undefined, scope }), {
      replace: true,
    });
  }, [query, scope]);

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const term = [query, filter].filter(Boolean).join(" ").trim();
    // The debounce only spaces requests out; it does not stop an earlier one landing
    // last. And the earlier one is systematically the slower: the count is computed
    // over the whole match set, so the shorter, broader term is the more expensive
    // query. Typing "a" then "abc" left the list, the "showing N of M" count and the
    // "show more" cursor all belonging to "a" — and clearing the box entirely painted
    // results for a search that was no longer on screen.
    let live = true;
    const timer = setTimeout(async () => {
      // Nothing typed, or the question is no longer about messages at all. Either way
      // the message view is reset rather than left holding the last search's list
      // behind a scope that is not showing it.
      if (scope !== "messages" || !term) {
        setResults(null);
        setTotal(0);
        setNextCursor(null);
        setParsed(null);
        setSearching(false);
        setFailure("none");
        return;
      }
      setSearching(true);
      try {
        const result = await api.search(term, undefined, sort);
        if (!live) return;
        setResults(result.messages);
        setTotal(result.total);
        setNextCursor(result.nextCursor);
        setParsed(result.parsed ?? null);
        setFailure("none");
      } catch (err) {
        // A failed request is not "no results" — telling someone nothing matched
        // when the server errored sends them away believing the message is gone.
        // Unless it is a *stale* failure, which says nothing about the search on
        // screen: a 429 from the abandoned query used to wipe results that had
        // already arrived and worked.
        if (!live) return;
        setResults(null);
        setTotal(0);
        setNextCursor(null);
        setParsed(null);
        setFailure(
          err instanceof ApiError && err.code === "rate_limited"
            ? "rate-limited"
            : "error",
        );
      } finally {
        if (live) setSearching(false);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, filter, sort, scope]);

  useEffect(() => {
    const term = query.trim();
    if (scope !== "files" || !term) {
      setFileHits(null);
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const result = await api.files.list({ q: term });
        if (live) setFileHits(result.items);
      } catch {
        if (live) setFileHits([]);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, scope]);

  // Channels never leave the client: the store holds exactly the asker's reach.
  const channels = useStore((s) => s.channels);
  const channelHits = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^#/, "");
    if (scope !== "channels" || !term) return null;
    return Object.values(channels).filter(
      (channel) =>
        !channel.archivedAt &&
        [channel.name, channel.topic, channel.description].some((field) =>
          (field ?? "").toLowerCase().includes(term),
        ),
    );
  }, [channels, query, scope]);

  const peopleHits = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^@/, "");
    if (!term) return [];
    return Object.values(people).filter(
      (person) =>
        !person.deactivated &&
        person.id !== me?.id &&
        person.displayName.toLowerCase().includes(term),
    );
  }, [people, me, query]);

  /**
   * The next page, appended.
   *
   * Appending rather than replacing, because "Showing 25 of 2107" was previously the end
   * of the road: anything the ranking did not put in the first page could not be reached
   * at all, and the only recourse was to guess a narrower query. The cursor is the
   * server's, opaque here — the client never computes an offset, so an arriving message
   * cannot shift a page boundary underneath somebody mid-read.
   */
  async function loadMore() {
    const term = [query, filter].filter(Boolean).join(" ").trim();
    if (!term || !nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      // The cursor carries its ordering, so it must go back with the one it came from.
      const result = await api.search(term, nextCursor, sort);
      setResults((current) => [...(current ?? []), ...result.messages]);
      setNextCursor(result.nextCursor);
    } catch {
      // Keep what is already on screen. Losing two hundred results you had scrolled
      // through because the two hundred and first request failed is a worse answer than
      // a button that did nothing.
      setFailure("none");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="pane">
      <div className="search-head">
        <div className="search-field">
          <SearchIcon size="md" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search messages — try from:@name or in:#channel"
            aria-label="Search messages"
          />
        </div>
        <div className="chip-row" role="group" aria-label="What to search">
          {SCOPES.map((option) => (
            <button
              key={option.value}
              className="chip"
              type="button"
              aria-pressed={scope === option.value}
              onClick={() => setScope(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {scope === "messages" && (
          <div className="chip-row">
            {FILTERS.map((f) => (
              <button
                key={f.label}
                className="chip"
                type="button"
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
            <div className="search-sort" role="group" aria-label="Sort results">
              {SORTS.map((option) => (
                <button
                  key={option.value}
                  className="chip"
                  type="button"
                  aria-pressed={sort === option.value}
                  onClick={() => setSort(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="search-results">
        {scope === "files" ? (
          fileHits === null ? (
            <EmptyState mark={<SearchIcon size="xl" />} title="Search files by name">
              Type part of a filename. Only files in conversations you are in are
              searched.
            </EmptyState>
          ) : fileHits.length === 0 ? (
            <EmptyState title={`No filename matches “${query}”`}>
              Try a shorter fragment — the match is anywhere in the name.
            </EmptyState>
          ) : (
            <ul className="browse-list">
              {fileHits.map((entry) => (
                <li key={entry.id} className="browse-row">
                  <div className="browse-row-main">
                    <div className="browse-row-name">{entry.filename}</div>
                    <div className="browse-row-meta">{entry.createdAt.slice(0, 10)}</div>
                  </div>
                  {/* The file is not the destination — the message carrying it is, which
                      is where it can be read in the conversation it was posted into. */}
                  <button
                    className="btn btn-ghost"
                    onClick={() => void showMessage(entry.messageId)}
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : scope === "channels" ? (
          channelHits === null ? (
            <EmptyState mark={<SearchIcon size="xl" />} title="Search channels by name">
              Type part of a name, a topic or a description. Only channels you can see
              are searched.
            </EmptyState>
          ) : channelHits.length === 0 ? (
            <EmptyState title={`No channel matches “${query}”`}>
              Try a shorter fragment — the match is anywhere in the name, the topic or
              the description.
            </EmptyState>
          ) : (
            <ul className="browse-list">
              {channelHits.map((channel) => (
                <li key={channel.id} className="browse-row">
                  <div className="browse-row-main">
                    <div className="browse-row-name">
                      <span className="channel-hash" aria-hidden="true">
                        #
                      </span>
                      {channel.name}
                    </div>
                    {/* Whichever the workspace actually filled in: both boxes answer
                        "what is this channel for". */}
                    {(channel.description || channel.topic) && (
                      <div className="browse-row-meta">
                        {channel.description || channel.topic}
                      </div>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      void showChannelFromResult(channel.id, {
                        joined: channel.membership !== null,
                        kind: channel.kind,
                      })
                    }
                  >
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : scope === "people" ? (
          !query.trim() ? (
            <EmptyState mark={<SearchIcon size="xl" />} title="Search people by name">
              Type part of a name. Everybody in the workspace is here, agents included.
            </EmptyState>
          ) : peopleHits.length === 0 ? (
            <EmptyState title={`Nobody matches “${query}”`}>
              Try a shorter fragment — the match is anywhere in the display name.
            </EmptyState>
          ) : (
            <ul className="browse-list">
              {peopleHits.map((person) => (
                <li key={person.id} className="browse-row">
                  <div className="browse-row-main">
                    <div className="browse-row-name">{person.displayName}</div>
                    {person.title && (
                      <div className="browse-row-meta">{person.title}</div>
                    )}
                  </div>
                  <button
                    className="btn btn-ghost"
                    onClick={() => void showDirectMessage(person.id)}
                  >
                    Message
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : failed ? (
          <EmptyState
            title={failure === "rate-limited" ? "Too many searches at once" : "Search didn’t answer"}
          >
            {failure === "rate-limited"
              ? "Give it a few seconds and search again — the query is fine, there have just been too many in a row."
              : "The server errored or couldn’t be reached — your messages are still there. Adjust the query or try again in a moment."}
          </EmptyState>
        ) : searching && results === null ? (
          // The first search of a session has no results array yet, so it fell into the
          // idle prompt below and sat there — on a slow connection, two and a half
          // seconds of a screen still inviting you to search something you had already
          // typed. `searching` was rendered, but only in the "no results" branch, which
          // needs an array to reach. Every later search keeps the previous results on
          // screen, which reads as stale rather than as broken; this one read as nothing
          // having happened at all.
          <EmptyState mark={<SearchIcon size="xl" />} title="Searching…" aria-live="polite">
            Looking through the whole history.
          </EmptyState>
        ) : results === null ? (
          <EmptyState mark={<SearchIcon size="xl" />} title="Search the whole history">
            Nothing is ever archived away. Narrow results with{" "}
            <code>from:</code>, <code>in:</code>, <code>has:link</code> or{" "}
            <code>before:</code>.
          </EmptyState>
        ) : results.length === 0 ? (
          <EmptyState title={searching ? "Searching…" : `Nothing matched “${query}”`}>
            {parsed?.unresolved?.length
              ? `Could not place ${parsed.unresolved.join(", ")}.`
              : "Try a shorter phrase, or drop the filters."}
          </EmptyState>
        ) : (
          <>
            <div className="search-count">
              {total > results.length
                ? `Showing ${results.length} of ${total}`
                : `${total} ${total === 1 ? "result" : "results"}`}
            </div>
            {parsed && echoTokens(parsed).length > 0 && (
              <div className="search-parsed" aria-label="Parsed query">
                {echoTokens(parsed).map((token) => (
                  <code key={token}>{token}</code>
                ))}
              </div>
            )}
            {results.map((message) => (
              <MessageResultRow
                key={message.id}
                message={message}
                timestamp={message.createdAt}
                highlight={parsed?.text || undefined}
                onOpen={() => void showMessage(message.id)}
              />
            ))}
            {nextCursor && (
              <button
                type="button"
                className="btn btn-ghost search-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Show more results"}
              </button>
            )}
          </>
        )}
      </div>
    </main>
  );
}
