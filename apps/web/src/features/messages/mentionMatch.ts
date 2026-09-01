/**
 * Which names a half-typed `@` could mean, best first.
 *
 * Its own module because the rule is worth stating once and worth testing against the
 * code that ships rather than a copy of it. The list's first row is what Enter takes, so
 * the *order* is the feature: a correct set in the wrong order still sends the mention to
 * somebody else, and a mention is a notification on a real person's phone.
 *
 * **Prefixes, not substrings.** A name matches when the query starts it, or starts one of
 * its words. Matching anywhere inside meant `@e` offered "Devin Cole" — the `e` in
 * "Devin" — so the first keystroke after `@` returned an arbitrary slice of the
 * workspace. Slack matches prefixes; people type the beginning of a name. Same
 * observation twice.
 *
 * **Rank before the cap.** The old code capped the store's own order, so in a workspace
 * larger than the cap the person being typed could be missing from a list with room for
 * them. Ranking first means the cap only ever drops worse matches.
 */

/** A whole-name prefix beats a prefix of a later word: "Ana Petrov" over "Priya Raman". */
export const RANK_NAME_PREFIX = 0;
export const RANK_WORD_PREFIX = 1;

/**
 * Anything that is not a letter or a digit separates words, so "Ana Petrov", "jean-paul"
 * and "o'brien" all offer their second part. Unicode-aware, because display names are
 * not ASCII.
 */
const WORD_BREAK = /[^\p{L}\p{N}]+/u;

/**
 * How well `name` answers `query`, or null when it does not.
 *
 * An empty query matches everything at the best rank: a bare `@` should list people
 * rather than nobody.
 */
export function rankName(name: string, query: string): number | null {
  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();
  if (needle === "") return RANK_NAME_PREFIX;
  if (haystack.startsWith(needle)) return RANK_NAME_PREFIX;
  for (const word of haystack.split(WORD_BREAK)) {
    if (word.startsWith(needle)) return RANK_WORD_PREFIX;
  }
  return null;
}

/**
 * The best rank across the names one candidate answers to, or null.
 *
 * A person is reachable by their display name and by their full name — Slack finds "Bob
 * Smith" when you type `@smith` and his display name is "bob" — while what gets inserted
 * is still the name the server resolves. Empty entries are skipped rather than coerced:
 * a missing full name should be absent, not an empty string that every query
 * prefix-matches.
 */
export function rankAliases(
  names: readonly (string | null | undefined)[],
  query: string,
): number | null {
  let best: number | null = null;
  for (const name of names) {
    if (!name) continue;
    const rank = rankName(name, query);
    if (rank !== null && (best === null || rank < best)) best = rank;
  }
  return best;
}

/**
 * The matching candidates, best first, then capped.
 *
 * `sortKey` breaks ties so the order is a property of the names rather than of whatever
 * order the store happened to be filled in: two people who match equally well appear in
 * the same order every time, on every client.
 */
export function matchMentions<T>(
  items: readonly T[],
  query: string,
  aliases: (item: T) => readonly (string | null | undefined)[],
  sortKey: (item: T) => string,
  limit: number,
): T[] {
  const scored: { item: T; rank: number; key: string }[] = [];
  for (const item of items) {
    const rank = rankAliases(aliases(item), query);
    if (rank === null) continue;
    scored.push({ item, rank, key: sortKey(item).toLowerCase() });
  }
  scored.sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
  return scored.slice(0, limit).map((entry) => entry.item);
}
