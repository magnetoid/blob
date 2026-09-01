import { describe, expect, it } from 'vitest';
import {
  CLEAR_AFTER_OPTIONS,
  optionForExpiry,
  presetsFor,
} from './statusClearAfter.ts';

const at = (iso: string) => new Date(iso);
const option = (id: string) => CLEAR_AFTER_OPTIONS.find((o) => o.id === id)!;

describe('when a status stops applying', () => {
  it('leaves it alone for "Don\'t clear"', () => {
    expect(option('never').at(at('2026-09-01T10:00:00'))).toBeNull();
  });

  it('counts a fixed span from the moment it is asked, not from midnight', () => {
    const now = at('2026-09-01T10:00:00');
    expect(option('30m').at(now)!.toISOString()).toBe(
      at('2026-09-01T10:30:00').toISOString(),
    );
    expect(option('4h').at(now)!.toISOString()).toBe(
      at('2026-09-01T14:00:00').toISOString(),
    );
  });

  it('ends "Today" at the end of the day it is asked on', () => {
    const end = option('today').at(at('2026-09-01T10:00:00'))!;
    expect(end.getDate()).toBe(1);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('rolls "This week" into the next month without help', () => {
    // The arithmetic that breaks when it is done by hand: the 29th plus seven days.
    // Monday 2026-12-28 → the coming Sunday is 2027-01-03.
    const end = option('week').at(at('2026-12-28T09:00:00'))!;
    expect(end.getFullYear()).toBe(2027);
    expect(end.getMonth()).toBe(0);
    expect(end.getDate()).toBe(3);
  });

  it('makes "This week" mean today when today is Sunday', () => {
    const sunday = at('2026-09-06T09:00:00');
    expect(sunday.getDay()).toBe(0);
    expect(option('week').at(sunday)!.getDate()).toBe(6);
  });
});

describe('which options are worth offering', () => {
  it('offers everything in the middle of a weekday', () => {
    const ids = presetsFor(at('2026-09-01T10:00:00')).map((o) => o.id);
    expect(ids).toEqual(['never', '30m', '1h', '4h', 'today', 'week']);
  });

  it('drops "Today" once it would mean minutes', () => {
    // At 23:58 it is "30 minutes" with a worse name and an earlier expiry.
    const ids = presetsFor(at('2026-09-01T23:58:00')).map((o) => o.id);
    expect(ids).not.toContain('today');
  });

  it('drops "This week" on the Sunday it would collapse into "Today"', () => {
    const ids = presetsFor(at('2026-09-06T10:00:00')).map((o) => o.id);
    expect(ids).toContain('today');
    expect(ids).not.toContain('week');
  });
});

describe('reopening the form on what the status says', () => {
  it('shows "Don\'t clear" when there is no expiry', () => {
    expect(optionForExpiry(null, at('2026-09-01T10:00:00'))).toBe('never');
  });

  it('shows "Don\'t clear" for one that has already passed', () => {
    // The server stops serving an expired status, so the form should not offer to
    // renew a span that is over.
    expect(
      optionForExpiry('2026-09-01T09:00:00.000Z', at('2026-09-01T10:00:00Z')),
    ).toBe('never');
  });

  it('names the span that is actually left, not the one it was set under', () => {
    // Set as "4 hours" three hours ago: an hour remains, and saying "4 hours" would
    // silently extend it on the next save.
    const now = at('2026-09-01T13:00:00Z');
    expect(optionForExpiry('2026-09-01T14:00:00.000Z', now)).toBe('1h');
  });
});
