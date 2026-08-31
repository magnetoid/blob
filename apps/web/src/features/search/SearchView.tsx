/**
 * Search.
 *
 * Supports the modifier grammar the server parses — `from:@name in:#channel
 * has:link before:2026-01-01` — with the free text as whatever is left over.
 */

import { useEffect, useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
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
  const [failed, setFailed] = useState(false);
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
        setSearching(false);
        setFailed(false);
        return;
      }
      setSearching(true);
      try {
        const result = await api.search(term);
        setResults(result.messages);
        setTotal(result.total);
        setFailed(false);
      } catch {
        // A failed request is not "no results" — telling someone nothing matched
        // when the server errored sends them away believing the message is gone.
        setResults(null);
        setTotal(0);
        setFailed(true);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query, filter]);

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
            <div className="empty-state-title">Search didn’t answer</div>
            <div className="empty-state-body">
              The server errored or couldn’t be reached — your messages are still
              there. Adjust the query or try again in a moment.
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
          </>
        )}
      </div>
    </main>
  );
}
