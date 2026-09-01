/**
 * When a status should stop being true.
 *
 * The server has always taken `status_expires_at`, stores it, and honours it — an
 * expired status is filtered out in `serialize.to_user`, which is why there is no
 * cleanup job. The client simply never offered a way to set one, so every status was
 * permanent and "Heads down until 3" was still on your name the next morning.
 *
 * Its own module because the arithmetic is the part that can be wrong. `presetsFor`
 * takes the moment rather than reading the clock, so a test can stand at midnight, at
 * the end of a month, and on the last day of a year without waiting.
 */

export interface ClearAfterOption {
  id: string;
  label: string;
  /** The moment it stops applying, or null for "leave it until I clear it". */
  at: (now: Date) => Date | null;
}

const minutes = (n: number) => (now: Date) =>
  new Date(now.getTime() + n * 60_000);

/** End of the calendar day the given moment falls in, in the viewer's own zone. */
function endOfToday(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * End of the coming Sunday — Slack's "this week".
 *
 * Built by adding days to a copy rather than by setting the date field to
 * `getDate() + n`, so the month and year roll over on their own. The 29th of a December
 * plus seven days is a problem only if you do the arithmetic yourself.
 */
function endOfWeek(now: Date): Date {
  const end = endOfToday(now);
  const daysUntilSunday = (7 - end.getDay()) % 7;
  end.setDate(end.getDate() + daysUntilSunday);
  return end;
}

export const CLEAR_AFTER_OPTIONS: readonly ClearAfterOption[] = [
  { id: "never", label: "Don't clear", at: () => null },
  { id: "30m", label: "30 minutes", at: minutes(30) },
  { id: "1h", label: "1 hour", at: minutes(60) },
  { id: "4h", label: "4 hours", at: minutes(240) },
  { id: "today", label: "Today", at: endOfToday },
  { id: "week", label: "This week", at: endOfWeek },
] as const;

/**
 * The options worth offering at this moment.
 *
 * "Today" is dropped once it would mean less than a quarter of an hour — at 23:58 it is
 * indistinguishable from "30 minutes" except in being wrong sooner — and "This week" is
 * dropped on the Sunday it would collapse into "Today".
 */
export function presetsFor(now: Date): ClearAfterOption[] {
  const soon = 15 * 60_000;
  return CLEAR_AFTER_OPTIONS.filter((option) => {
    const at = option.at(now);
    if (at === null) return true;
    if (option.id === "today") return at.getTime() - now.getTime() > soon;
    if (option.id === "week")
      return at.getTime() - endOfToday(now).getTime() > 0;
    return true;
  });
}

/** Which option a stored expiry came from, for reopening the form on what it says. */
export function optionForExpiry(expiresAt: string | null, now: Date): string {
  if (!expiresAt) return "never";
  const remaining = new Date(expiresAt).getTime() - now.getTime();
  if (remaining <= 0) return "never";
  // Nearest by remaining time, so a status set an hour ago as "4 hours" reopens as
  // something honest rather than as the label it was chosen under.
  const timed = CLEAR_AFTER_OPTIONS.filter((o) => o.id !== "never");
  let best = timed[0] as ClearAfterOption;
  let bestGap = Infinity;
  for (const option of timed) {
    const at = option.at(now);
    if (!at) continue;
    const gap = Math.abs(at.getTime() - now.getTime() - remaining);
    if (gap < bestGap) {
      bestGap = gap;
      best = option;
    }
  }
  return best.id;
}
