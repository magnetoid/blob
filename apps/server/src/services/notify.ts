/**
 * Who gets notified, and how.
 *
 * Notification fatigue is the single most common complaint about every incumbent
 * chat app, so the rules here are deliberately conservative: silence is the default
 * and each delivery has to be justified by an explicit signal.
 */

import type { NotifyLevel, UserPrefs } from '@blob/shared';
import { DEFAULT_PREFS, matchesKeywords } from '@blob/shared';
import { query } from '../db/pool.ts';

export interface Recipient {
  userId: string;
  notifyLevel: NotifyLevel;
  prefs: UserPrefs;
  timezone: string;
}

export interface NotifiableMessage {
  id: string;
  channelId: string;
  channelKind: 'public' | 'private' | 'dm' | 'group_dm';
  authorId: string | null;
  body: string;
  mentionUserIds: string[];
  mentionsEveryone: boolean;
  threadRootId: string | null;
}

export type NotifyReason = 'dm' | 'mention' | 'everyone' | 'keyword' | 'all_activity' | 'thread';

export interface Decision {
  userId: string;
  reason: NotifyReason;
  /** True when the mention badge should increment (mentions and DMs only). */
  countsAsMention: boolean;
}

/**
 * Decide who to notify. Pure function of message + recipients, so it is exhaustively
 * unit-testable without a database.
 */
export function decide(
  message: NotifiableMessage,
  recipients: Recipient[],
  now = new Date(),
  threadSubscribers: Set<string> = new Set(),
): Decision[] {
  const decisions: Decision[] = [];

  for (const recipient of recipients) {
    if (recipient.userId === message.authorId) continue;
    if (recipient.notifyLevel === 'none') continue;
    if (isSnoozed(recipient, now)) continue;

    const isDm = message.channelKind === 'dm' || message.channelKind === 'group_dm';
    const mentioned = message.mentionUserIds.includes(recipient.userId);

    if (isDm) {
      decisions.push({ userId: recipient.userId, reason: 'dm', countsAsMention: true });
      continue;
    }
    if (mentioned) {
      decisions.push({ userId: recipient.userId, reason: 'mention', countsAsMention: true });
      continue;
    }
    // Muted channels already returned above, so reaching here means they opted in.
    if (message.mentionsEveryone) {
      decisions.push({ userId: recipient.userId, reason: 'everyone', countsAsMention: true });
      continue;
    }
    if (matchesKeywords(message.body, recipient.prefs.keywords)) {
      decisions.push({ userId: recipient.userId, reason: 'keyword', countsAsMention: true });
      continue;
    }
    if (message.threadRootId && threadSubscribers.has(recipient.userId)) {
      decisions.push({ userId: recipient.userId, reason: 'thread', countsAsMention: false });
      continue;
    }
    if (recipient.notifyLevel === 'all') {
      decisions.push({ userId: recipient.userId, reason: 'all_activity', countsAsMention: false });
    }
  }

  return decisions;
}

/** Manual snooze, or outside the user's configured working hours. */
export function isSnoozed(recipient: Recipient, now: Date): boolean {
  const { snoozeUntil, dnd } = recipient.prefs;
  if (snoozeUntil && new Date(snoozeUntil).getTime() > now.getTime()) return true;
  if (!dnd?.enabled) return false;

  const local = localParts(now, recipient.timezone);
  if (dnd.days.length > 0 && !dnd.days.includes(local.weekday)) return true;

  const { startHour, endHour } = dnd;
  // Quiet hours are *outside* [startHour, endHour); a window that wraps midnight
  // (e.g. 9→18 means quiet 18:00–09:00) is handled by the same comparison.
  if (startHour === endHour) return false;
  const withinWorkingHours =
    startHour < endHour
      ? local.hour >= startHour && local.hour < endHour
      : local.hour >= startHour || local.hour < endHour;
  return !withinWorkingHours;
}

function localParts(date: Date, timezone: string): { hour: number; weekday: number } {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
      weekday: 'short',
    });
    const parts = fmt.formatToParts(date);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? date.getHours());
    const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return { hour: hour % 24, weekday: Math.max(0, weekdays.indexOf(weekdayName)) };
  } catch {
    return { hour: date.getUTCHours(), weekday: date.getUTCDay() };
  }
}

/** Load the notification-relevant state for every member of a channel. */
export async function loadRecipients(channelId: string): Promise<Recipient[]> {
  const rows = await query<{
    user_id: string;
    notify_level: NotifyLevel;
    prefs: Partial<UserPrefs> | null;
    timezone: string;
  }>(
    `SELECT cm.user_id, cm.notify_level, u.prefs, u.timezone
       FROM channel_members cm
       JOIN users u ON u.id = cm.user_id
      WHERE cm.channel_id = $1 AND u.deactivated_at IS NULL`,
    [channelId],
  );

  return rows.map((r) => ({
    userId: r.user_id,
    notifyLevel: r.notify_level,
    prefs: { ...DEFAULT_PREFS, ...(r.prefs ?? {}) },
    timezone: r.timezone,
  }));
}

export async function loadThreadSubscribers(threadRootId: string): Promise<Set<string>> {
  const rows = await query<{ user_id: string }>(
    'SELECT user_id FROM thread_subscriptions WHERE thread_root_id = $1 AND muted = false',
    [threadRootId],
  );
  return new Set(rows.map((r) => r.user_id));
}
