import { describe, expect, it } from 'vitest';
import { matchMentions, rankName, RANK_NAME_PREFIX, RANK_WORD_PREFIX } from './mentionMatch.ts';

interface Person {
  displayName: string;
  fullName?: string | null;
}

const people = (...names: string[]): Person[] => names.map((displayName) => ({ displayName }));

/** The composer's own call, so the tests exercise the arguments that ship. */
const offer = (candidates: Person[], query: string, limit = 6): string[] =>
  matchMentions(
    candidates,
    query,
    (p) => [p.displayName, p.fullName],
    (p) => p.displayName,
    limit,
  ).map((p) => p.displayName);

describe('ranking one name', () => {
  it('prefers a name the query starts', () => {
    expect(rankName('Ana Petrov', 'an')).toBe(RANK_NAME_PREFIX);
  });

  it('still finds a later word', () => {
    // "@raman" should reach Priya. Surnames are the second word for most of the world.
    expect(rankName('Priya Raman', 'ram')).toBe(RANK_WORD_PREFIX);
  });

  it('refuses a match that starts nothing', () => {
    // The bug in one line: "ma" sits inside "Raman", and that used to be enough.
    expect(rankName('Priya Raman', 'ma')).toBeNull();
  });

  it('lists everyone for a bare @', () => {
    expect(rankName('Devin Cole', '')).toBe(RANK_NAME_PREFIX);
  });

  it('breaks words on punctuation, not just spaces', () => {
    expect(rankName('jean-paul', 'paul')).toBe(RANK_WORD_PREFIX);
    expect(rankName("Siobhán O'Brien", 'brien')).toBe(RANK_WORD_PREFIX);
  });
});

describe('offering candidates', () => {
  it('does not offer a name the query merely appears inside', () => {
    // `@e` used to offer "Devin Cole" — the e in "Devin" — so the first keystroke after
    // the @ returned an arbitrary slice of the workspace.
    expect(offer(people('Devin Cole', 'Marko Ilic'), 'e')).toEqual([]);
    expect(offer(people('Marko Ilic', 'Priya Raman'), 'ma')).toEqual(['Marko Ilic']);
  });

  it('puts the whole-name match above the surname match', () => {
    // Both match "ra". The first row is what Enter takes, so this ordering is the
    // difference between mentioning Radek and mentioning Priya.
    expect(offer(people('Priya Raman', 'Radek Novak'), 'ra')).toEqual([
      'Radek Novak',
      'Priya Raman',
    ]);
  });

  it('orders equal matches by name rather than by store order', () => {
    const forwards = offer(people('Marko Ilic', 'Maja Kovac'), 'ma');
    const backwards = offer(people('Maja Kovac', 'Marko Ilic'), 'ma');
    expect(forwards).toEqual(['Maja Kovac', 'Marko Ilic']);
    expect(backwards).toEqual(forwards);
  });

  it('keeps the best matches when there are more than fit', () => {
    // The sharp edge of capping before ranking. Forty people contain "zo" — inside
    // "Alonzo" — and sort ahead of the one person it actually starts, so the cap used to
    // fill up with them and drop Zoran from a list that had six rows for him.
    const workspace = people(
      ...Array.from({ length: 40 }, (_, i) => `Alonzo ${String(i).padStart(2, '0')}`),
      'Zoran Babic',
    );
    expect(offer(workspace, 'zo')).toEqual(['Zoran Babic']);
  });

  it('caps at the limit once ranked', () => {
    const workspace = people(...Array.from({ length: 20 }, (_, i) => `Ana ${i}`));
    expect(offer(workspace, 'ana')).toHaveLength(6);
  });

  it('finds someone by a full name they do not go by', () => {
    // Display name "bob", full name "Bob Smith": "@smith" should reach him, and what
    // gets inserted is still the name the server resolves.
    const candidates: Person[] = [{ displayName: 'bob', fullName: 'Bob Smith' }];
    expect(offer(candidates, 'smith')).toEqual(['bob']);
  });

  it('does not let a missing full name match everything', () => {
    // A null alias skipped, not coerced to "" — which every query prefix-matches.
    const candidates: Person[] = [{ displayName: 'Devin Cole', fullName: null }];
    expect(offer(candidates, 'zz')).toEqual([]);
  });
});
