/**
 * The rules that are easy to get wrong and silent when they are.
 *
 * Two of these guard decisions rather than mechanics. A workspace's own `:tada:` has to
 * beat the built-in one, or an upload becomes unreachable by the name it was given. And a
 * reaction whose custom emoji was deleted has to resolve to nothing rather than to a URL,
 * so the pill can fall back to text instead of rendering a broken image.
 */

import { describe, expect, it } from 'vitest';
import type { CustomEmoji } from '@blob/shared';
import {
  isShortcode,
  reactionValue,
  resolveName,
  resolveReaction,
  searchEmoji,
  shortcodeName,
} from './emoji.ts';

const shipit: CustomEmoji = { name: 'shipit', url: 'https://files.test/shipit.png' };
const ownTada: CustomEmoji = { name: 'tada', url: 'https://files.test/tada.gif' };

describe('shortcodes', () => {
  it('recognises a shortcode and rejects a bare character', () => {
    expect(isShortcode(':shipit:')).toBe(true);
    expect(isShortcode('👍')).toBe(false);
    expect(isShortcode(':not a shortcode:')).toBe(false);
  });

  it('extracts the name', () => {
    expect(shortcodeName(':shipit:')).toBe('shipit');
    expect(shortcodeName('👍')).toBeNull();
  });
});

describe('resolveName', () => {
  it('finds a built-in by name', () => {
    expect(resolveName('tada', [])).toEqual({ kind: 'unicode', name: 'tada', char: '🎉' });
  });

  it('finds a custom emoji', () => {
    expect(resolveName('shipit', [shipit])).toEqual({
      kind: 'custom',
      name: 'shipit',
      url: shipit.url,
    });
  });

  it("lets a workspace's own emoji win the name", () => {
    expect(resolveName('tada', [ownTada])).toEqual({
      kind: 'custom',
      name: 'tada',
      url: ownTada.url,
    });
  });

  it('returns null for a name nobody has', () => {
    expect(resolveName('definitely_not_an_emoji', [shipit])).toBeNull();
  });
});

describe('resolveReaction', () => {
  it('treats a stored character as itself', () => {
    expect(resolveReaction('👍', [])).toEqual({ kind: 'unicode', name: '👍', char: '👍' });
  });

  it('resolves a stored shortcode against the workspace', () => {
    expect(resolveReaction(':shipit:', [shipit])).toEqual({
      kind: 'custom',
      name: 'shipit',
      url: shipit.url,
    });
  });

  it('resolves to nothing once the custom emoji is deleted', () => {
    // The caller renders the raw `:shipit:` text rather than a broken image.
    expect(resolveReaction(':shipit:', [])).toBeNull();
  });
});

describe('reactionValue', () => {
  it('stores a character for Unicode and a shortcode for custom', () => {
    expect(reactionValue({ kind: 'unicode', name: 'tada', char: '🎉' })).toBe('🎉');
    expect(reactionValue({ kind: 'custom', name: 'shipit', url: shipit.url })).toBe(':shipit:');
  });
});

describe('searchEmoji', () => {
  it('puts an exact name first', () => {
    expect(searchEmoji('heart', [])[0]).toMatchObject({ name: 'heart' });
  });

  it('ranks a prefix match above a mid-word one', () => {
    const names = searchEmoji('heart', []).map((e) => e.name);
    // `heart_eyes` starts with the query; `broken_heart` merely contains it.
    expect(names.indexOf('heart_eyes')).toBeLessThan(names.indexOf('broken_heart'));
  });

  it('searches keywords, not just names', () => {
    expect(searchEmoji('lgtm', []).map((e) => e.name)).toContain('thumbsup');
  });

  it('tolerates the colons people type out of habit', () => {
    expect(searchEmoji(':tada:', [])[0]).toMatchObject({ name: 'tada' });
  });

  it("ranks a workspace's own emoji ahead of a Unicode one that scored the same", () => {
    const names = searchEmoji('tada', [ownTada]).map((e) => e.name);
    expect(names[0]).toBe('tada');
    expect(searchEmoji('tada', [ownTada])[0]).toMatchObject({ kind: 'custom' });
  });

  it('offers custom emoji first when there is no query at all', () => {
    expect(searchEmoji('', [shipit])[0]).toMatchObject({ kind: 'custom', name: 'shipit' });
  });

  it('finds nothing for a query nothing matches', () => {
    expect(searchEmoji('zzzzzzz', [shipit])).toEqual([]);
  });
});
