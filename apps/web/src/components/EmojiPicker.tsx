/**
 * The emoji picker's body — its search, its grid, its keys and its skin tones — used both
 * to react to a message and to insert into the composer. The popover round it, and so
 * opening, closing, Escape and where focus goes, is `EmojiPopover.tsx`'s.
 *
 * Slack's picker opens on a search field with the cursor already in it, because the fast
 * path is typing three letters and pressing Enter — not hunting a grid. So the popover puts
 * the cursor there (`searchRef`), Enter takes the first result, and the arrow keys walk the
 * list.
 *
 * A workspace's own emoji come first and stay first. They are the vocabulary that is
 * actually specific to the people using this deployment; the Unicode set is the same
 * everywhere and can wait one row.
 */

import { useMemo, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
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
} from '../lib/emoji.ts';
import { useStore } from '../lib/store.ts';
import { Input } from './ui/input.tsx';
import { Toggle } from './ui/toggle.tsx';

interface Props {
  /** Receives the value to store: the character, or `:name:` for a custom emoji. */
  onPick: (value: string) => void;
  /** The search field, which the popover puts the cursor in as it opens. */
  searchRef?: Ref<HTMLInputElement> | undefined;
}

/**
 * One cell of the grid. The keyboard's cursor (`data-active`) is painted as an image layer
 * over the cell's ground rather than as the ground itself, because the ground is what the
 * pointer's highlight fades — and a transition cannot tell which of the two changed it, so
 * a cursor painted there faded out of every cell the arrow keys left. The focus ring sits
 * inside the cell's edge: the cells touch, so a ring outside one would be drawn over its
 * neighbours.
 */
const CELL =
  'flex aspect-square cursor-pointer items-center justify-center rounded-sm text-(length:--blob-text-lg) leading-none outline-none transition-[background-color,scale] duration-(--dur-fast) ease-(--blob-ease-out) hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset active:scale-(--motion-press) data-[active=true]:bg-[image:linear-gradient(var(--blob-accent-wash),var(--blob-accent-wash))] data-[active=true]:shadow-[inset_0_0_0_1px_var(--blob-accent-border)]';

const GRID = 'grid grid-cols-8 gap-0.5';

function displayedChar(emoji: Extract<ResolvedEmoji, { kind: 'unicode' }>, modifier: string): string {
  return takesSkinTone(emoji.name) ? applySkinTone(emoji.char, modifier) : emoji.char;
}

function pickValue(emoji: ResolvedEmoji, modifier: string): string {
  if (emoji.kind === 'custom') return reactionValue(emoji);
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
      className={CELL}
      data-active={active}
      type="button"
      title={`:${emoji.name}:`}
      aria-label={`:${emoji.name}:`}
      onClick={() => onPick(pickValue(emoji, modifier))}
    >
      {emoji.kind === 'custom' ? (
        // Sized to the line, as a custom emoji is wherever it renders (`.custom-emoji`), so
        // it matches the Unicode one beside it.
        <img className="size-[1.35em] object-contain" src={emoji.url} alt="" loading="lazy" />
      ) : (
        displayedChar(emoji, modifier)
      )}
    </button>
  );
}

/**
 * A named group of emoji. Groups, not headings: a picker's internal labels are not
 * document structure, and no heading level is reliably right, because what precedes a
 * popover depends on where it opened. They were h4, which skipped a level and broke
 * heading navigation for the whole page. A reader still hears "Smileys and people, group"
 * on the way in.
 */
function Group({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section role="group" aria-labelledby={id}>
      <p className="mb-1 px-0.5 text-xs font-semibold text-muted-foreground" id={id}>
        {label}
      </p>
      <div className={GRID}>{children}</div>
    </section>
  );
}

export function EmojiPicker({ onPick, searchRef }: Props) {
  const customEmoji = useStore((s) => s.customEmoji);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [toneId, setToneId] = useState<SkinToneId>(loadSkinToneId);
  const modifier = skinToneById(toneId).modifier;

  const results = useMemo(
    () => (query.trim() ? searchEmoji(query, customEmoji) : []),
    [query, customEmoji],
  );

  // A query that narrows under the cursor would otherwise leave it pointing past the end.
  const clamped = Math.min(cursor, Math.max(results.length - 1, 0));

  const onKeyDown = (event: KeyboardEvent) => {
    if (!results.length) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[clamped];
      if (chosen) onPick(pickValue(chosen, modifier));
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor(Math.min(clamped + 1, results.length - 1));
      return;
    }
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(Math.max(clamped - 1, 0));
    }
  };

  const own: ResolvedEmoji[] = customEmoji.map((c) => ({
    kind: 'custom',
    name: c.name,
    url: c.url,
  }));

  return (
    <>
      <Input
        ref={searchRef}
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

      <div className="min-h-0 overflow-y-auto">
        {query.trim() ? (
          results.length ? (
            <div className={GRID}>
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
            <p className="mx-1 my-3 text-(length:--blob-text-sm) text-muted-foreground">
              No emoji matches “{query.trim()}”.
            </p>
          )
        ) : (
          <div className="flex flex-col gap-2.5">
            {own.length > 0 && (
              <Group id="emoji-group-own" label="This workspace">
                {own.map((emoji) => (
                  <EmojiButton
                    key={`custom:${emoji.name}`}
                    emoji={emoji}
                    active={false}
                    modifier={modifier}
                    onPick={onPick}
                  />
                ))}
              </Group>
            )}

            {EMOJI_CATEGORIES.map((category) => (
              <Group key={category.id} id={`emoji-group-${category.id}`} label={category.label}>
                {category.entries.map((entry) => (
                  <EmojiButton
                    key={entry.name}
                    emoji={{ kind: 'unicode', name: entry.name, char: entry.char }}
                    active={false}
                    modifier={modifier}
                    onPick={onPick}
                  />
                ))}
              </Group>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-0.5 border-t border-border pt-2" role="group" aria-label="Skin tone">
        {SKIN_TONES.map((tone) => (
          <Toggle
            key={tone.id}
            className="flex-1 rounded-sm text-(length:--blob-text-lg) leading-none active:scale-(--motion-press) aria-pressed:bg-(--blob-accent-wash) aria-pressed:shadow-[inset_0_0_0_1px_var(--blob-accent-border)]"
            aria-label={tone.label}
            pressed={tone.id === toneId}
            // The tone shown pressed is the one in use, so pressing it again keeps it.
            onPressedChange={() => {
              setToneId(tone.id);
              saveSkinToneId(tone.id);
            }}
          >
            {tone.swatch}
          </Toggle>
        ))}
      </div>
    </>
  );
}
