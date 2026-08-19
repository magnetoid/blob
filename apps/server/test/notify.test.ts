/**
 * Notification rules.
 *
 * Notification fatigue is the top complaint about every incumbent, so these tests
 * assert silence as much as delivery.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, type UserPrefs } from '@blob/shared';
import { decide, isSnoozed, type NotifiableMessage, type Recipient } from '../src/services/notify.ts';

const recipient = (over: Partial<Recipient> & { userId: string }): Recipient => ({
  notifyLevel: 'mentions',
  prefs: { ...DEFAULT_PREFS },
  timezone: 'UTC',
  ...over,
});

const message = (over: Partial<NotifiableMessage> = {}): NotifiableMessage => ({
  id: 'm1',
  channelId: 'c1',
  channelKind: 'public',
  authorId: 'author',
  body: 'hello everyone',
  mentionUserIds: [],
  mentionsEveryone: false,
  threadRootId: null,
  ...over,
});

describe('decide', () => {
  it('never notifies the author of their own message', () => {
    const decisions = decide(message({ mentionUserIds: ['author'] }), [
      recipient({ userId: 'author' }),
    ]);
    expect(decisions).toEqual([]);
  });

  it('stays silent for ordinary channel chatter', () => {
    expect(decide(message(), [recipient({ userId: 'u1' })])).toEqual([]);
  });

  it('notifies on a direct mention and counts it as a badge', () => {
    const decisions = decide(message({ mentionUserIds: ['u1'] }), [recipient({ userId: 'u1' })]);
    expect(decisions).toEqual([{ userId: 'u1', reason: 'mention', countsAsMention: true }]);
  });

  it('notifies every recipient of a DM', () => {
    const decisions = decide(message({ channelKind: 'dm' }), [recipient({ userId: 'u1' })]);
    expect(decisions[0]).toMatchObject({ reason: 'dm', countsAsMention: true });
  });

  it('notifies on a keyword hit', () => {
    const prefs: UserPrefs = { ...DEFAULT_PREFS, keywords: ['postgres'] };
    const decisions = decide(message({ body: 'postgres is down' }), [
      recipient({ userId: 'u1', prefs }),
    ]);
    expect(decisions[0]).toMatchObject({ reason: 'keyword' });
  });

  it('notifies about all activity when the channel is set to all', () => {
    const decisions = decide(message(), [recipient({ userId: 'u1', notifyLevel: 'all' })]);
    expect(decisions[0]).toMatchObject({ reason: 'all_activity', countsAsMention: false });
  });

  it('says nothing at all when the channel is muted, even for a mention', () => {
    const decisions = decide(message({ mentionUserIds: ['u1'] }), [
      recipient({ userId: 'u1', notifyLevel: 'none' }),
    ]);
    expect(decisions).toEqual([]);
  });

  it('respects a manual snooze', () => {
    const prefs: UserPrefs = {
      ...DEFAULT_PREFS,
      snoozeUntil: new Date(Date.now() + 60_000).toISOString(),
    };
    const decisions = decide(message({ mentionUserIds: ['u1'] }), [
      recipient({ userId: 'u1', prefs }),
    ]);
    expect(decisions).toEqual([]);
  });

  it('notifies thread subscribers about replies without counting a badge', () => {
    const decisions = decide(
      message({ threadRootId: 'root' }),
      [recipient({ userId: 'u1' })],
      new Date(),
      new Set(['u1']),
    );
    expect(decisions[0]).toMatchObject({ reason: 'thread', countsAsMention: false });
  });

  it('treats @channel as a notification for members who have not muted', () => {
    const decisions = decide(message({ mentionsEveryone: true }), [
      recipient({ userId: 'u1' }),
      recipient({ userId: 'u2', notifyLevel: 'none' }),
    ]);
    expect(decisions.map((d) => d.userId)).toEqual(['u1']);
  });
});

describe('isSnoozed', () => {
  const withDnd = (over: Partial<UserPrefs['dnd'] & object>) =>
    recipient({
      userId: 'u1',
      prefs: {
        ...DEFAULT_PREFS,
        dnd: { enabled: true, startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5], ...over },
      },
    });

  it('is quiet outside working hours', () => {
    // Tuesday 22:00 UTC
    expect(isSnoozed(withDnd({}), new Date('2026-08-18T22:00:00Z'))).toBe(true);
  });

  it('allows notifications during working hours', () => {
    expect(isSnoozed(withDnd({}), new Date('2026-08-18T10:00:00Z'))).toBe(false);
  });

  it('is quiet on a non-working day', () => {
    // Saturday
    expect(isSnoozed(withDnd({}), new Date('2026-08-22T10:00:00Z'))).toBe(true);
  });

  it('handles a window that wraps midnight', () => {
    const nightShift = withDnd({ startHour: 22, endHour: 6, days: [] });
    expect(isSnoozed(nightShift, new Date('2026-08-18T23:00:00Z'))).toBe(false);
    expect(isSnoozed(nightShift, new Date('2026-08-18T12:00:00Z'))).toBe(true);
  });

  it('respects the recipient timezone rather than the server clock', () => {
    const tokyo = recipient({
      userId: 'u1',
      timezone: 'Asia/Tokyo',
      prefs: {
        ...DEFAULT_PREFS,
        dnd: { enabled: true, startHour: 9, endHour: 18, days: [] },
      },
    });
    // 01:00 UTC is 10:00 in Tokyo — inside working hours there, outside here.
    expect(isSnoozed(tokyo, new Date('2026-08-18T01:00:00Z'))).toBe(false);
  });

  it('does nothing when DND is off', () => {
    expect(isSnoozed(recipient({ userId: 'u1' }), new Date('2026-08-18T03:00:00Z'))).toBe(false);
  });
});
