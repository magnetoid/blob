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
 *
 * The shell is shadcn's popover, from the overlay chunk (`components/overlays/PopoverImpl.tsx`):
 * it places the panel — below "Add reaction", or above the composer, as the caller's
 * stylesheet says in `--popover-side` and `--popover-align` on `.emoji-picker` — wears
 * shadcn's popover surface, plays the entrance, and puts the cursor in the search field.
 * The search, the grid, the keys and the tones inside it are the picker's own legacy
 * markup, in a `data-legacy` island so legacy CSS still reaches it inside shadcn's popup.
 *
 * Closing is not the picker's. Its callers keep the open state, the anchor round it, Escape
 * through `lib/useEscape` and the click outside, decided by `contains` on that anchor — so
 * the panel is drawn in place, inside the anchor, where `contains` finds it, and the picker
 * brings no second Escape or outside click of its own (one Escape closes one layer). It is
 * open for as long as it is mounted and goes when its caller unmounts it, with no exit,
 * as before.
 *
 * Scaffolding, with an exit: the callers move to `PopoverTrigger` in phase 5, and the
 * anchor, the in-place drawing and the callers' own dismissal go then.
 */

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  EMOJI_CATEGORIES,
  SKIN_TONES,
  applySkinTone,
  loadSkinToneId,
  reactionValue,
  saveSkinToneId,
  searchEmoji,
  skinToneById,
  takesSkinTone,
  type ResolvedEmoji,
  type SkinToneId,
} from "../lib/emoji.ts";
import { useStore } from "../lib/store.ts";
import { lazyOverlay } from "./lazyOverlay.tsx";
import { PanelAnchor } from "./PanelAnchor.tsx";

/** Base UI's popover root, portal, positioner and popup, from the overlay chunk. */
const PickerPanel = lazyOverlay((m) => m.PopoverImpl);

interface Props {
  /** Receives the value to store: the character, or `:name:` for a custom emoji. */
  onPick: (value: string) => void;
  onClose: () => void;
  /** Labels the panel for assistive tech — "React with an emoji" vs "Insert an emoji". */
  label: string;
}

function displayedChar(emoji: Extract<ResolvedEmoji, { kind: "unicode" }>, modifier: string): string {
  return takesSkinTone(emoji.name) ? applySkinTone(emoji.char, modifier) : emoji.char;
}

function pickValue(emoji: ResolvedEmoji, modifier: string): string {
  if (emoji.kind === "custom") return reactionValue(emoji);
  return displayedChar(emoji, modifier);
}

/** One button in the grid. Custom emoji are images; the built-in set is text. */
function EmojiButton({
  emoji,
  active,
  modifier,
  onPick,
}: {
  emoji: ResolvedEmoji;
  active: boolean;
  modifier: string;
  onPick: (value: string) => void;
}) {
  return (
    <button
      className="emoji-cell"
      data-active={active}
      type="button"
      title={`:${emoji.name}:`}
      aria-label={`:${emoji.name}:`}
      onClick={() => onPick(pickValue(emoji, modifier))}
    >
      {emoji.kind === "custom" ? (
        <img className="custom-emoji" src={emoji.url} alt="" loading="lazy" />
      ) : (
        displayedChar(emoji, modifier)
      )}
    </button>
  );
}

export function EmojiPicker({ onPick, onClose, label }: Props) {
  const customEmoji = useStore((s) => s.customEmoji);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [toneId, setToneId] = useState<SkinToneId>(loadSkinToneId);
  const inputRef = useRef<HTMLInputElement>(null);
  const modifier = skinToneById(toneId).modifier;

  // Where the panel is drawn, inside the caller's anchor, so the caller's `contains` finds it.
  const anchorRef = useRef<HTMLSpanElement>(null);
  // What had focus as the picker opened: the button that opened it. The cursor goes into the
  // search field only from there, or from nowhere — a picker opened before the chunk landed
  // is drawn late, and by then the person may have moved on (`PopoverImpl`'s `initialFocus`).
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
      if (chosen) onPick(pickValue(chosen, modifier));
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
    <PanelAnchor anchor={anchorRef}>
      <PickerPanel
        open
        anchor={anchorRef}
        opener={openerRef}
        label={label}
        className="emoji-picker"
        initialFocus={inputRef}
      >
        <div data-legacy="" className="contents">
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
                      modifier={modifier}
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
                          modifier={modifier}
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
                          modifier={modifier}
                          onPick={onPick}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>

          <div className="emoji-tones" role="group" aria-label="Skin tone">
            {SKIN_TONES.map((tone) => (
              <button
                key={tone.id}
                className="emoji-tone"
                type="button"
                aria-label={tone.label}
                aria-pressed={tone.id === toneId}
                onClick={() => {
                  setToneId(tone.id);
                  saveSkinToneId(tone.id);
                }}
              >
                {tone.swatch}
              </button>
            ))}
          </div>
        </div>
      </PickerPanel>
    </PanelAnchor>
  );
}
