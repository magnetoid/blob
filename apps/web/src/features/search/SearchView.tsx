/**
 * Search.
 *
 * Supports the modifier grammar the server parses — `from:@name in:#channel
 * has:link before:2026-01-01` — with the free text as whatever is left over.
 */

import { useEffect, useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { Avatar } from "../../components/Avatar.tsx";
import { SearchIcon } from "../../components/Icon.tsx";
import { formatRelative } from "../messages/messageFormatting.ts";

const FILTERS = [
  { label: "All", value: "" },
  { label: "Has file", value: "has:file" },
  { label: "Has link", value: "has:link" },
] as const;

export function SearchView() {
  const users = useStore((s) => s.users);
  const channels = useStore((s) => s.channels);
  const openChannel = useStore((s) => s.openChannel);
  const channelTitle = useStore((s) => s.channelTitle);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [results, setResults] = useState<Message[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
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
        return;
      }
      setSearching(true);
      try {
        const result = await api.search(term);
        setResults(result.messages);
        setTotal(result.total);
      } catch {
        setResults([]);
        setTotal(0);
      } finally {
        setSearching(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [query, filter]);

  return (
    <div className="pane">
      <div className="search-head">
        <div className="search-field">
          <SearchIcon size={16} strokeWidth={1.8} />
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
        {results === null ? (
          <div className="empty-state">
            <div className="empty-state-mark">
              <SearchIcon size={19} />
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
              {total} {total === 1 ? "result" : "results"}
            </div>
            {results.map((message) => {
              const author = message.authorId
                ? users[message.authorId]
                : undefined;
              const channel = channels[message.channelId];
              return (
                <button
                  key={message.id}
                  className="search-result"
                  type="button"
                  onClick={() => void openChannel(message.channelId)}
                >
                  <Avatar user={author} size="lg" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="search-result-head">
                      <span className="search-result-author">
                        {author?.displayName ?? "Someone"}
                      </span>
                      <span className="search-result-meta">
                        {channel
                          ? channel.name
                            ? `#${channel.name}`
                            : channelTitle(channel)
                          : "Unknown"}{" "}
                        · {formatRelative(message.createdAt)}
                      </span>
                    </div>
                    <div className="search-result-text">{message.body}</div>
                  </div>
                </button>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
