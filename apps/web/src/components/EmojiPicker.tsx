/**
 * The emoji picker, used both to react to a message and to insert into the composer.
 *
 * Slack's picker opens on a search field with the cursor already in it, because the fast
 * path is typing three letters and pressing Enter — not hunting a grid. So Enter takes
 * the first result, the arrow keys walk the list, and Escape closes without picking.
 *
 * A workspace's own emoji come first and stay first. They are the vocabulary that is
 * actually specific to the people using this deployment; the Unicode set is the same
 * everywhere and can wait one row.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  EMOJI_CATEGORIES,
  reactionValue,
  searchEmoji,
  type ResolvedEmoji,
} from "../lib/emoji.ts";
import { useStore } from "../lib/store.ts";

interface Props {
  /** Receives the value to store: the character, or `:name:` for a custom emoji. */
  onPick: (value: string) => void;
  onClose: () => void;
  /** Labels the panel for assistive tech — "React with an emoji" vs "Insert an emoji". */
  label: string;
}

/** One button in the grid. Custom emoji are images; the built-in set is text. */
function EmojiButton({
  emoji,
  active,
  onPick,
}: {
  emoji: ResolvedEmoji;
  active: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <button
      className="emoji-cell"
      data-active={active}
      type="button"
      title={`:${emoji.name}:`}
      aria-label={`:${emoji.name}:`}
      onClick={() => onPick(reactionValue(emoji))}
    >
      {emoji.kind === "custom" ? (
        <img className="custom-emoji" src={emoji.url} alt="" loading="lazy" />
      ) : (
        emoji.char
      )}
    </button>
  );
}

export function EmojiPicker({ onPick, onClose, label }: Props) {
  const customEmoji = useStore((s) => s.customEmoji);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(
    () => (query.trim() ? searchEmoji(query, customEmoji) : []),
    [query, customEmoji],
  );

  // A query that narrows under the cursor would otherwise leave it pointing past the end.
  const clamped = Math.min(cursor, Math.max(results.length - 1, 0));

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (!results.length) return;

    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = results[clamped];
      if (chosen) onPick(reactionValue(chosen));
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      setCursor(Math.min(clamped + 1, results.length - 1));
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(Math.max(clamped - 1, 0));
    }
  };

  const own: ResolvedEmoji[] = customEmoji.map((c) => ({
    kind: "custom",
    name: c.name,
    url: c.url,
  }));

  return (
    <div className="emoji-picker" role="dialog" aria-label={label}>
      <input
        ref={inputRef}
        className="emoji-search"
        type="search"
        value={query}
        placeholder="Search emoji"
        aria-label="Search emoji"
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
        onKeyDown={onKeyDown}
      />

      <div className="emoji-scroll">
        {query.trim() ? (
          results.length ? (
            <div className="emoji-grid">
              {results.map((emoji, index) => (
                <EmojiButton
                  key={`${emoji.kind}:${emoji.name}`}
                  emoji={emoji}
                  active={index === clamped}
                  onPick={onPick}
                />
              ))}
            </div>
          ) : (
            <p className="emoji-empty">No emoji matches “{query.trim()}”.</p>
          )
        ) : (
          <>
            {/* Groups, not headings.
                These were h4, which skipped a level and broke heading navigation for
                the whole page — and no level is reliably right, because what precedes
                a popover depends on where it opened. The document's own order is
                already h2, h2, h1: the sidebar's section labels come before the
                channel title. A picker's internal labels are not document structure,
                so they name a group instead of joining the outline, and a reader still
                hears "Smileys and people, group" on the way in. */}
            {own.length > 0 && (
              <section
                className="emoji-section"
                role="group"
                aria-labelledby="emoji-group-own"
              >
                <p className="emoji-heading" id="emoji-group-own">
                  {"This workspace"}
                </p>
                <div className="emoji-grid">
                  {own.map((emoji) => (
                    <EmojiButton
                      key={`custom:${emoji.name}`}
                      emoji={emoji}
                      active={false}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </section>
            )}

            {EMOJI_CATEGORIES.map((category) => (
              <section
                className="emoji-section"
                key={category.id}
                role="group"
                aria-labelledby={`emoji-group-${category.id}`}
              >
                <p className="emoji-heading" id={`emoji-group-${category.id}`}>
                  {category.label}
                </p>
                <div className="emoji-grid">
                  {category.entries.map((entry) => (
                    <EmojiButton
                      key={entry.name}
                      emoji={{
                        kind: "unicode",
                        name: entry.name,
                        char: entry.char,
                      }}
                      active={false}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
