/**
 * Search.
 *
 * Supports the modifier grammar the server parses — `from:@name in:#channel
 * has:link before:2026-01-01` — with the free text as whatever is left over.
 */

import { useEffect, useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api, ApiError, type ParsedSearchQuery, type SearchSort } from "../../lib/api.ts";
import { showMessage } from "../../lib/navigation.ts";
import { SearchIcon } from "../../components/Icon.tsx";
import { MessageResultRow } from "../messages/MessageResultRow.tsx";

const SORTS: Array<{ value: SearchSort; label: string }> = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'newest', label: 'Most recent' },
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

export function SearchView() {
  const [query, setQuery] = useState("");
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
      if (!term) {
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
  }, [query, filter, sort]);

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
      </div>

      <div className="search-results">
        {failed ? (
          <div className="empty-state">
            <div className="empty-state-title">
              {failure === "rate-limited"
                ? "Too many searches at once"
                : "Search didn’t answer"}
            </div>
            <div className="empty-state-body">
              {failure === "rate-limited"
                ? "Give it a few seconds and search again — the query is fine, there have just been too many in a row."
                : "The server errored or couldn’t be reached — your messages are still there. Adjust the query or try again in a moment."}
            </div>
          </div>
        ) : searching && results === null ? (
          // The first search of a session has no results array yet, so it fell into the
          // idle prompt below and sat there — on a slow connection, two and a half
          // seconds of a screen still inviting you to search something you had already
          // typed. `searching` was rendered, but only in the "no results" branch, which
          // needs an array to reach. Every later search keeps the previous results on
          // screen, which reads as stale rather than as broken; this one read as nothing
          // having happened at all.
          <div className="empty-state" aria-live="polite">
            <div className="empty-state-mark">
              <SearchIcon size="xl" />
            </div>
            <div className="empty-state-title">Searching…</div>
            <div className="empty-state-body">
              Looking through the whole history.
            </div>
          </div>
        ) : results === null ? (
          <div className="empty-state">
            <div className="empty-state-mark">
              <SearchIcon size="xl" />
            </div>
            <div className="empty-state-title">Search the whole history</div>
            <div className="empty-state-body">
              Nothing is ever archived away. Narrow results with{" "}
              <code>from:</code>, <code>in:</code>, <code>has:link</code> or{" "}
              <code>before:</code>.
            </div>
          </div>
        ) : results.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">
              {searching ? "Searching…" : `Nothing matched “${query}”`}
            </div>
            <div className="empty-state-body">
              {parsed?.unresolved?.length
                ? `Could not place ${parsed.unresolved.join(", ")}.`
                : "Try a shorter phrase, or drop the filters."}
            </div>
          </div>
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
