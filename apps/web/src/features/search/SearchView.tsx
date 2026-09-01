/**
 * Search.
 *
 * Supports the modifier grammar the server parses — `from:@name in:#channel
 * has:link before:2026-01-01` — with the free text as whatever is left over.
 */

import { useEffect, useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api, ApiError } from "../../lib/api.ts";
import { showMessage } from "../../lib/navigation.ts";
import { SearchIcon } from "../../components/Icon.tsx";
import { MessageResultRow } from "../messages/MessageResultRow.tsx";

const FILTERS = [
  { label: "All", value: "" },
  { label: "Has file", value: "has:file" },
  { label: "Has link", value: "has:link" },
] as const;

export function SearchView() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("");
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
  const [loadingMore, setLoadingMore] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const term = [query, filter].filter(Boolean).join(" ").trim();
    const timer = setTimeout(async () => {
      if (!term) {
        setResults(null);
        setTotal(0);
        setNextCursor(null);
        setSearching(false);
        setFailure("none");
        return;
      }
      setSearching(true);
      try {
        const result = await api.search(term);
        setResults(result.messages);
        setTotal(result.total);
        setNextCursor(result.nextCursor);
        setFailure("none");
      } catch (err) {
        // A failed request is not "no results" — telling someone nothing matched
        // when the server errored sends them away believing the message is gone.
        setResults(null);
        setTotal(0);
        setNextCursor(null);
        setFailure(
          err instanceof ApiError && err.code === "rate_limited"
            ? "rate-limited"
            : "error",
        );
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query, filter]);

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
      const result = await api.search(term, nextCursor);
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
              Try a shorter phrase, or drop the filters.
            </div>
          </div>
        ) : (
          <>
            <div className="search-count">
              {total > results.length
                ? `Showing ${results.length} of ${total}`
                : `${total} ${total === 1 ? "result" : "results"}`}
            </div>
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
