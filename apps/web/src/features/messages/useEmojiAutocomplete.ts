/** `:shortcode` autocomplete, over the built-in set and the workspace's own emoji. */

import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import { useStore } from "../../lib/store.ts";
import {
  reactionValue,
  searchEmoji,
  type ResolvedEmoji,
} from "../../lib/emoji.ts";
import { useAutocomplete } from "./useAutocomplete.ts";

const TRAILING_SHORTCODE = /(?:^|[\s]):([a-z0-9_+-]{1,32})$/i;

export function useEmojiAutocomplete(
  draft: string,
  setDraft: (value: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): {
  query: string | null;
  candidates: ResolvedEmoji[];
  index: number;
  track: (before: string) => void;
  apply: (emoji: ResolvedEmoji) => void;
  handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  const customEmoji = useStore((s) => s.customEmoji);
  const [query, setQuery] = useState<string | null>(null);
  const candidates = useMemo(
    () => (query ? searchEmoji(query, customEmoji, 8) : []),
    [query, customEmoji],
  );

  function apply(emoji: ResolvedEmoji) {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? draft.length;
    const inserted = `${reactionValue(emoji)} `;
    const replaced = draft.slice(0, caret).replace(/:[a-z0-9_+-]*$/i, inserted);
    const next = replaced + draft.slice(caret);
    setDraft(next);
    setQuery(null);
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(replaced.length, replaced.length);
    });
  }

  const list = useAutocomplete(candidates, apply, () => setQuery(null));

  function track(before: string) {
    const colon = before.match(TRAILING_SHORTCODE);
    setQuery(colon ? (colon[1] ?? "") : null);
    list.reset();
  }

  return {
    query,
    candidates,
    index: list.index,
    track,
    apply,
    handleKey: (event) => query !== null && list.handleKey(event),
  };
}
