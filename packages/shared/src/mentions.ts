/**
 * Mention parsing, shared so the client highlights exactly what the server notifies.
 *
 * A mention is `@` followed by a display name in the workspace. Names may contain
 * spaces, so we match greedily against the known-name set rather than by regex alone.
 */

export interface MentionResult {
  /** Ids of users named directly. */
  userIds: string[];
  /** True when @channel or @here appeared. */
  everyone: boolean;
  /** True specifically for @here (notify only active members). */
  hereOnly: boolean;
}

export const EVERYONE_TOKENS = ['channel', 'everyone'] as const;
export const HERE_TOKEN = 'here';

/** Longest display name we will try to match, in words. */
const MAX_NAME_WORDS = 4;

/**
 * Extract mentions from raw markdown.
 *
 * `nameToId` keys must be lowercased display names. Code spans and fenced blocks
 * are stripped first so `@channel` inside a code sample never pings anyone.
 */
export function parseMentions(body: string, nameToId: Map<string, string>): MentionResult {
  const text = stripCode(body);
  const userIds = new Set<string>();
  let everyone = false;
  let hereOnly = false;

  const re = /@([\p{L}\p{N}][\p{L}\p{N}._'-]*(?:\s+[\p{L}\p{N}][\p{L}\p{N}._'-]*)*)/gu;
  for (const match of text.matchAll(re)) {
    const candidate = match[1];
    if (!candidate) continue;

    const words = candidate.split(/\s+/).slice(0, MAX_NAME_WORDS);
    // Prefer the longest matching name: "@Ana Maria" beats "@Ana".
    let matched = false;
    for (let take = words.length; take >= 1; take--) {
      const phrase = words.slice(0, take).join(' ').toLowerCase();
      const bare = phrase.replace(/[.,!?;:]+$/, '');
      const id = nameToId.get(bare);
      if (id) {
        userIds.add(id);
        matched = true;
        break;
      }
      if (take === 1) {
        if ((EVERYONE_TOKENS as readonly string[]).includes(bare)) {
          everyone = true;
          matched = true;
        } else if (bare === HERE_TOKEN) {
          everyone = true;
          hereOnly = true;
          matched = true;
        }
      }
    }
    if (!matched) continue;
  }

  return { userIds: [...userIds], everyone, hereOnly };
}

/** Remove fenced blocks and inline code so their contents never mention anyone. */
export function stripCode(body: string): string {
  return body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

/** Does this message body hit any of the user's keyword alerts? */
export function matchesKeywords(body: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const text = stripCode(body).toLowerCase();
  return keywords.some((k) => {
    const needle = k.trim().toLowerCase();
    if (!needle) return false;
    // Word-boundary match so "ops" doesn't fire on "developops".
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(needle)}($|[^\\p{L}\\p{N}])`, 'u');
    return re.test(text);
  });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
