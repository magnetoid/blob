/**
 * What you typed and did not send.
 *
 * The rules worth pinning are the ones that decide whether a draft is *there*: blank
 * removes rather than storing an empty string, because "has a draft" is a question about
 * key presence and the sidebar's indicator reads it that way. And the map has to be
 * bounded — it is otherwise append-only for the life of a browser profile.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  channelHasDraft,
  draftKey,
  flushDrafts,
  loadDrafts,
  persistDrafts,
  pruneDrafts,
  schedulePersist,
  withDraft,
  type Drafts,
} from './drafts.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-24T12:00:00.000Z');

function entry(body: string, agoMs = 0): Drafts[string] {
  return { body, updatedAt: new Date(NOW - agoMs).toISOString() };
}

/** The suite runs in node, so storage is supplied the way `outbox.test.ts` supplies it. */
class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  storage.clear();
  // Any write a previous test left pending would otherwise land in this one's storage.
  flushDrafts();
  storage.clear();
});

describe('keys', () => {
  it('separates a thread from the channel it is in', () => {
    // Replying in a thread and talking in the channel are two places to be mid-sentence,
    // and Slack keeps them apart.
    expect(draftKey('c1', null)).toBe('c1');
    expect(draftKey('c1', 'm9')).not.toBe(draftKey('c1', null));
  });
});

describe('withDraft', () => {
  it('stores what was typed', () => {
    const next = withDraft({}, 'c1', 'half a thought', NOW);
    expect(next.c1?.body).toBe('half a thought');
  });

  it('removes the entry when the body is blanked', () => {
    const existing = withDraft({}, 'c1', 'typed', NOW);
    expect(withDraft(existing, 'c1', '', NOW)).toEqual({});
  });

  it('treats whitespace as blank', () => {
    const existing = withDraft({}, 'c1', 'typed', NOW);
    // Otherwise clearing the box with select-all-delete can leave a space behind and
    // the channel keeps claiming a draft nobody can see.
    expect(withDraft(existing, 'c1', '   \n ', NOW)).toEqual({});
  });

  it('returns the same object when nothing moved', () => {
    // The store leans on this to avoid re-rendering every subscriber on a keystroke
    // that lands back on the same text.
    const existing = withDraft({}, 'c1', 'typed', NOW);
    expect(withDraft(existing, 'c1', 'typed', NOW)).toBe(existing);
    expect(withDraft({}, 'c1', '', NOW)).toEqual({});
  });

  it('leaves other channels alone', () => {
    let drafts = withDraft({}, 'c1', 'one', NOW);
    drafts = withDraft(drafts, 'c2', 'two', NOW);
    drafts = withDraft(drafts, 'c1', '', NOW);
    expect(Object.keys(drafts)).toEqual(['c2']);
  });
});

describe('channelHasDraft', () => {
  it('is true for a draft in the channel or in one of its threads', () => {
    const inChannel = withDraft({}, 'c1', 'typed', NOW);
    const inThread = withDraft({}, draftKey('c1', 'm9'), 'typed', NOW);
    expect(channelHasDraft(inChannel, 'c1')).toBe(true);
    expect(channelHasDraft(inThread, 'c1')).toBe(true);
    expect(channelHasDraft(inThread, 'c2')).toBe(false);
  });

  it('does not mistake a channel whose id is a prefix of another', () => {
    // `startsWith` is doing the thread lookup, so the separator has to be part of the
    // test or `c1` would claim `c12`'s drafts.
    const other = withDraft({}, 'c12', 'typed', NOW);
    expect(channelHasDraft(other, 'c1')).toBe(false);
  });
});

describe('pruning', () => {
  it('forgets a draft nobody has touched in a month', () => {
    const drafts = { fresh: entry('recent', DAY), stale: entry('ancient', 40 * DAY) };
    expect(Object.keys(pruneDrafts(drafts, NOW))).toEqual(['fresh']);
  });

  it('drops an entry whose timestamp is unreadable', () => {
    const drafts = { bad: { body: 'typed', updatedAt: 'not a date' } };
    // An unparseable date would otherwise sit in the map forever, immune to the age
    // check that is supposed to bound it.
    expect(pruneDrafts(drafts, NOW)).toEqual({});
  });

  it('keeps the newest when there are more than fit', () => {
    const drafts: Drafts = {};
    for (let i = 0; i < 250; i += 1) drafts[`c${i}`] = entry(`draft ${i}`, i * 1000);
    const pruned = pruneDrafts(drafts, NOW);
    expect(Object.keys(pruned)).toHaveLength(200);
    expect(pruned.c0).toBeDefined(); // Newest.
    expect(pruned.c249).toBeUndefined(); // Oldest.
  });
});

describe('storage', () => {
  it('round-trips through localStorage', () => {
    persistDrafts(withDraft({}, 'c1', 'typed', NOW));
    expect(loadDrafts(NOW).c1?.body).toBe('typed');
  });

  it('survives a corrupt payload rather than throwing', () => {
    storage.setItem('blob.web.drafts.v1', '{not json');
    expect(loadDrafts(NOW)).toEqual({});
  });

  it('ignores a payload of the wrong shape', () => {
    storage.setItem('blob.web.drafts.v1', '{"c1":"a bare string"}');
    // One malformed entry discards the lot rather than crashing the composer on read.
    expect(loadDrafts(NOW)).toEqual({});
  });

  it('removes the key entirely when the last draft goes', () => {
    persistDrafts(withDraft({}, 'c1', 'typed', NOW));
    persistDrafts({});
    expect(storage.getItem('blob.web.drafts.v1')).toBeNull();
  });

  it('prunes on the way in, so a stale draft never reaches the composer', () => {
    persistDrafts({ stale: entry('ancient', 40 * DAY) });
    expect(loadDrafts(NOW)).toEqual({});
  });
});

describe('scheduled writes', () => {
  it('does not write until flushed', () => {
    schedulePersist(withDraft({}, 'c1', 'typed', NOW));
    // The point of scheduling: the keystroke does not pay for a stringify of every
    // draft you hold.
    expect(storage.getItem('blob.web.drafts.v1')).toBeNull();
    flushDrafts();
    expect(loadDrafts(NOW).c1?.body).toBe('typed');
  });

  it('writes only the last value scheduled', () => {
    schedulePersist(withDraft({}, 'c1', 'first', NOW));
    schedulePersist(withDraft({}, 'c1', 'second', NOW));
    flushDrafts();
    expect(loadDrafts(NOW).c1?.body).toBe('second');
  });

  it('flushing with nothing owed is harmless', () => {
    flushDrafts();
    flushDrafts();
    expect(loadDrafts(NOW)).toEqual({});
  });
});
