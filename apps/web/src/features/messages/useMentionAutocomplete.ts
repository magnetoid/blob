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
  /** The conversation being typed into, whose members are offered first. */
  channelId: string,
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
  const recentUserIds = useStore((s) => s.recentMentionUserIds);
  const recentGroupIds = useStore((s) => s.recentMentionGroupIds);
  const [query, setQuery] = useState<string | null>(null);
  const members = useConversationMembers(channelId);

  const candidates = useMemo<MentionCandidate[]>(() => {
    if (query === null) return [];
    const q = query.toLowerCase();

    // People in this conversation first, because only members are notified — a name
    // Enter takes has to be somebody the mention reaches — and whom you tagged last
    // first among those. One number carries both: a member's is their place in the
    // recent list (everyone untagged sharing the place after it), and a non-member's
    // is that same number pushed past every member's.
    const personRecency = new Map(recentUserIds.map((id, place) => [id, place]));
    const untagged = personRecency.size;
    const people: MentionCandidate[] = matchMentions(
      Object.values(users).filter(
        // An agent that is uninstalled or switched off is not a mention worth
        // offering: the name would resolve and nothing would ever answer it.
        (u) => !u.deactivated && !u.agentDisabled && u.id !== currentUser?.id,
      ),
      q,
      (u) => [u.displayName, u.fullName],
      (u) => u.displayName,
      6,
      (u) =>
        (personRecency.get(u.id) ?? untagged) +
        (members && !members.has(u.id) ? untagged + 1 : 0),
    ).map((u) => ({ kind: "user", key: u.id, label: u.displayName, user: u }));

    // Not self-filtered, unlike people above. Excluding yourself from a list of people
    // is right — you do not mention yourself — and exactly wrong for a group you are
    // on, which is the one you are most likely to be addressing. Matched on its name as
    // well as its handle, because "@plat" should find `@platform-team` whether you were
    // reaching for the handle or the words behind it.
    const groupRecency = new Map(recentGroupIds.map((id, place) => [id, place]));
    const groups: MentionCandidate[] = matchMentions(
      Object.values(groupsById),
      q,
      (g) => [g.handle, g.name],
      (g) => g.handle,
      4,
      (g) => groupRecency.get(g.id) ?? groupRecency.size,
    ).map((g) => ({ kind: "group", key: g.id, label: g.handle, hint: g.name }));

    const specials: MentionCandidate[] = ["channel", "here"]
      .filter((s) => s.startsWith(q))
      .map((name) => ({ kind: "special", key: `@${name}`, label: name }));

    // Each kind is ranked on its own; this is only the order of the kinds. The first
    // row is what Enter takes, so the two broadcasts go last, even when what was typed
    // matches them best: a keystroke should never notify a whole channel by default.
    return [...people, ...groups, ...specials];
  }, [query, users, groupsById, currentUser, recentUserIds, recentGroupIds, members]);

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
    (candidate) => candidate.key,
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

/**
 * Who is in the conversation being typed into, or null while that is not known.
 *
 * Read, never fetched. A DM or group DM carries its members on the channel itself. A
 * public or private channel's `memberIds` is null on the wire and is never read here;
 * its list is the one the channel view fetched when the channel opened, so it is known
 * before anybody types `@` — fetched from here instead, it landed while the list was
 * open and re-sorted it under the highlight. While a refetch after a join is in flight
 * it can be one membership behind, and ranking by the room as it was a moment ago beats
 * ranking without it.
 */
function useConversationMembers(channelId: string): ReadonlySet<string> | null {
  const kind = useStore((s) => s.channels[channelId]?.kind);
  const carried = useStore((s) => s.channels[channelId]?.memberIds ?? null);
  const fetched = useStore((s) => s.channelMembers[channelId]?.userIds ?? null);
  const direct = kind === "dm" || kind === "group_dm" ? carried : null;

  return useMemo(() => {
    const ids = direct ?? fetched;
    return ids ? new Set(ids) : null;
  }, [direct, fetched]);
}
