/** The build stamp, and the parts of it that are arithmetic rather than substitution.
 *
 * The constants themselves come from `vite.config.ts` and are whatever the repository
 * said at build time, so they are not what is worth pinning — the shaping is. In
 * particular `commitsByDay`, which is what makes a list of sixty commit subjects
 * readable instead of a wall.
 */

import { describe, expect, it } from 'vitest';
import {
  BUILD_COMMITS,
  commitUrl,
  commitsByDay,
  formatBuildTime,
  type BuildCommit,
} from './buildInfo.ts';

function commit(shortSha: string, date: string, subject = 'did a thing'): BuildCommit {
  return { sha: `${shortSha}0000000000000000000000000000000`, shortSha, subject, date, author: 'Ana' };
}

describe('grouping commits by day', () => {
  it('puts the newest day first', () => {
    const days = commitsByDay([
      commit('aaa', '2026-09-01T10:00:00+02:00'),
      commit('bbb', '2026-09-02T09:00:00+02:00'),
    ]);

    expect(days.map((day) => day.date)).toEqual(['2026-09-02', '2026-09-01']);
  });

  it('keeps the commits of a day in the order they arrived', () => {
    // git log is newest-first, and that order is meaningful within a day too.
    const days = commitsByDay([
      commit('aaa', '2026-09-02T18:00:00Z', 'later'),
      commit('bbb', '2026-09-02T09:00:00Z', 'earlier'),
    ]);

    expect(days[0]?.commits.map((c) => c.subject)).toEqual(['later', 'earlier']);
  });

  it('groups by the day the author was in, not by UTC', () => {
    // A commit at 00:30+02:00 is the 2nd where it was written and the 1st in UTC. The
    // date git records carries the offset, and the day it belongs to is the local one —
    // slicing the ISO string keeps that, where a Date would not.
    const days = commitsByDay([commit('aaa', '2026-09-02T00:30:00+02:00')]);

    expect(days[0]?.date).toBe('2026-09-02');
  });

  it('says nothing when there is nothing', () => {
    expect(commitsByDay([])).toEqual([]);
  });
});

describe('linking to a commit', () => {
  it('has nowhere to point without a repository url', () => {
    // Which is the case for a checkout with no remote — the page then prints the sha
    // as text rather than as a link that goes nowhere.
    expect(commitUrl('')).toBe('');
  });
});

describe('the build time', () => {
  it('is empty rather than "Invalid Date" when it is not a time', () => {
    expect(formatBuildTime('')).toBe('');
    expect(formatBuildTime('not a time')).toBe('');
  });

  it('renders a real one', () => {
    expect(formatBuildTime('2026-09-02T04:12:00Z')).not.toBe('');
  });
});

describe('the commits the build carries', () => {
  it('is a list, whatever git said', () => {
    // The constant is JSON parsed out of a string the build inlined; a malformed or
    // absent one must come through as an empty list rather than as undefined, because
    // every reader here iterates it.
    expect(Array.isArray(BUILD_COMMITS)).toBe(true);
  });
});
