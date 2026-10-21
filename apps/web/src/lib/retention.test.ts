/**
 * What a conversation's members are told about how long it keeps things (ADR 0039). The
 * rule is the same sentence for everybody — "or someone in it" — so a person's own hold
 * is never named to the people they talk with.
 */
import { describe, expect, it } from 'vitest';
import { keptFor, windowLabel } from './retention.ts';

describe('keptFor', () => {
  it('says nothing where everything is kept and nothing is held', () => {
    expect(keptFor(null, null)).toBeNull();
    expect(keptFor({ messageDays: null, fileDays: null, held: true }, null)).toBeNull();
  });

  it('names the windows, with the hold as the rule rather than a person', () => {
    expect(keptFor({ messageDays: 365, fileDays: 30, held: false }, null)).toBe(
      'This workspace removes messages after 1 year and files after 30 days, unless the conversation or someone in it is on legal hold.',
    );
    expect(keptFor({ messageDays: 90, fileDays: 365, held: true }, null)).toBe(
      'This workspace removes messages after 90 days, unless the conversation or someone in it is on legal hold.',
    );
  });

  it('says a conversation is held, since when', () => {
    expect(keptFor({ messageDays: 90, fileDays: null, held: false }, '2026-10-02T10:00:00Z')).toMatch(
      /^On legal hold since .*2026: kept past this workspace’s retention\.$/,
    );
  });
});

describe('windowLabel', () => {
  it('reads the offered windows by name and any other as days', () => {
    expect([windowLabel(180), windowLabel(1), windowLabel(40)]).toEqual([
      '6 months',
      '1 day',
      '40 days',
    ]);
  });
});
