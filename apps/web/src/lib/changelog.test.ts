// @vitest-environment happy-dom
/** The release notes, and the dot beside the menu row.
 *
 * The invariant worth guarding is the order. `LATEST_RELEASE` is `RELEASES[0]` and
 * "newer than what I have seen" is a string comparison against its date, so a new entry
 * appended at the *bottom* — the natural thing to do to a list — would leave the dot
 * permanently off and the page showing the newest update last. Nothing would fail.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LATEST_RELEASE,
  RELEASES,
  formatReleaseDate,
  hasUnseenRelease,
  labelFor,
  markReleasesSeen,
} from './changelog.ts';

const KEY = 'blob.changelog.seen';

/**
 * happy-dom here provides `window` but not `localStorage`, which is why `outbox.test.ts`
 * carries the same shim. Worth noting that the un-shimmed environment is itself the
 * "storage unavailable" case, and `changelog.ts` survives it — that is what the last
 * two tests below assert deliberately rather than by accident.
 */
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

function installStorage(storage: unknown): void {
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

const throwing = {
  getItem() {
    throw new Error('denied');
  },
  setItem() {
    throw new Error('quota');
  },
};

beforeEach(() => {
  installStorage(new MemoryStorage());
  vi.restoreAllMocks();
});

describe('the list itself', () => {
  it('is newest first', () => {
    const dates = RELEASES.map((release) => release.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('names the newest one, which is what the dot compares against', () => {
    expect(LATEST_RELEASE).toBe(RELEASES[0]);
  });

  it('has a title and at least one entry in every release', () => {
    // A release with no entries renders as a date and a heading saying nothing.
    for (const release of RELEASES) {
      expect(release.title.length).toBeGreaterThan(0);
      expect(release.entries.length).toBeGreaterThan(0);
      expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('labels every kind it uses', () => {
    for (const release of RELEASES) {
      for (const entry of release.entries) {
        expect(labelFor(entry.kind)).toBeTruthy();
      }
    }
  });
});

describe('what counts as unseen', () => {
  it('is unseen for somebody who has never opened it', () => {
    // Otherwise the page would be a thing you have to already know about to find out
    // exists, which is what "Soon" had made it for months.
    expect(hasUnseenRelease()).toBe(true);
  });

  it('is seen once the page has been opened', () => {
    markReleasesSeen();
    expect(window.localStorage.getItem(KEY)).toBe(LATEST_RELEASE.date);
    expect(hasUnseenRelease()).toBe(false);
  });

  it('is unseen again when something newer ships', () => {
    window.localStorage.setItem(KEY, '2020-01-01');
    expect(hasUnseenRelease()).toBe(true);
  });

  it('does not treat an older stored date as newer', () => {
    window.localStorage.setItem(KEY, '9999-12-31');
    expect(hasUnseenRelease()).toBe(false);
  });
});

describe('when storage is unavailable', () => {
  it('shows the dot rather than failing to start', () => {
    // Safari's private mode throws on access instead of returning null. A changelog
    // must never be the reason the app does not boot.
    installStorage(throwing);
    expect(() => hasUnseenRelease()).not.toThrow();
    expect(hasUnseenRelease()).toBe(true);
  });

  it('swallows a failed write', () => {
    installStorage(throwing);
    expect(() => markReleasesSeen()).not.toThrow();
  });

  it('survives storage being absent entirely', () => {
    installStorage(undefined);
    expect(() => hasUnseenRelease()).not.toThrow();
    expect(() => markReleasesSeen()).not.toThrow();
  });
});

describe('formatReleaseDate', () => {
  it('gives back the raw string for something unparseable', () => {
    expect(formatReleaseDate('not-a-date')).toBe('not-a-date');
  });

  it('renders a real date as something readable', () => {
    expect(formatReleaseDate('2026-08-25')).toMatch(/2026/);
  });
});
