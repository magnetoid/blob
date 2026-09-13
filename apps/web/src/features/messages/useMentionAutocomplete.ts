/** `@` autocomplete against the same name index the server resolves mentions with,
 *  so what highlights here is exactly what notifies there. */

import { useMemo, useState, type KeyboardEvent, type RefObject } from "react";
import type { User } from "@blob/shared";
import { matchMentions } from "./mentionMatch.ts";
import { useStore } from "../../lib/store.ts";
import { useAutocomplete } from "./useAutocomplete.ts";

/**
 * One row of the `@` autocomplete.
 *
 * A discriminated union rather than a loose object with an id that might start with "@".
 * The old shape worked because a person and a special both happened to have a
 * `displayName` and an `avatarUrl`; a group has neither, and would have reached `Avatar`
 * as a silently wrong shape.
 */
export type MentionCandidate =
  | { kind: "special"; key: string; label: string; hint?: string; user?: never }
  | { kind: "group"; key: string; label: string; hint?: string; user?: never }
  | { kind: "user"; key: string; label: string; hint?: string; user: User };

const TRAILING_MENTION = /@([\p{L}\p{N}._'-]*)$/u;

export function useMentionAutocomplete(
  draft: string,
  setDraft: (value: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
): {
  query: string | null;
  candidates: MentionCandidate[];
  index: number;
  /** Called with the text before the caret on every edit; says whether a `@word` is open. */
  track: (before: string) => boolean;
  apply: (name: string) => void;
  handleKey: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
} {
  const users = useStore((s) => s.users);
  const groupsById = useStore((s) => s.groups);
  const currentUser = useStore((s) => s.currentUser);
  const [query, setQuery] = useState<string | null>(null);

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (query === null) return [];
    const q = query.toLowerCase();

    const specials: MentionCandidate[] = ["channel", "here"]
      .filter((s) => s.startsWith(q))
      .map((name) => ({ kind: "special", key: `@${name}`, label: name }));

    // Not self-filtered, unlike people below. Excluding yourself from a list of people
    // is right — you do not mention yourself — and exactly wrong for a group you are
    // on, which is the one you are most likely to be addressing. Matched on its name as
    // well as its handle, because "@plat" should find `@platform-team` whether you were
    // reaching for the handle or the words behind it.
    const groups: MentionCandidate[] = matchMentions(
      Object.values(groupsById),
      q,
      (g) => [g.handle, g.name],
      (g) => g.handle,
      4,
    ).map((g) => ({ kind: "group", key: g.id, label: g.handle, hint: g.name }));

    const people: MentionCandidate[] = matchMentions(
      Object.values(users).filter(
        (u) => !u.deactivated && u.id !== currentUser?.id,
      ),
      q,
      (u) => [u.displayName, u.fullName],
      (u) => u.displayName,
      6,
    ).map((u) => ({ kind: "user", key: u.id, label: u.displayName, user: u }));

    return [...specials, ...groups, ...people];
  }, [query, users, groupsById, currentUser]);

  function apply(name: string) {
    const node = textareaRef.current;
    const caret = node?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(TRAILING_MENTION, `@${name} `);
    const next = before + draft.slice(caret);
    setDraft(next);
    setQuery(null);
    requestAnimationFrame(() => {
      node?.focus();
      node?.setSelectionRange(before.length, before.length);
    });
  }

  const list = useAutocomplete(
    candidates,
    (chosen) => apply(chosen.label),
    () => setQuery(null),
  );

  function track(before: string): boolean {
    const match = before.match(TRAILING_MENTION);
    setQuery(match ? (match[1] ?? "") : null);
    list.reset();
    return match !== null;
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
