/** When "later" means, in the reader's own day.
 *
 * Slack's set, and the reasoning is the same: the useful times to schedule for are not
 * durations but *moments* somebody can picture — tomorrow morning, Monday morning —
 * because the reason to schedule at all is usually "not now, and not the middle of the
 * night for whoever reads it".
 *
 * Computed against the local clock rather than fixed offsets, so "Tomorrow at 9:00" is
 * nine in the morning where the author is, which is what they meant.
 */

import type { ScheduleRepeat } from '@blob/shared';

export interface SchedulePreset {
  id: string;
  label: string;
  at: (now: Date) => Date;
}

function atHour(from: Date, addDays: number, hour: number): Date {
  const when = new Date(from);
  when.setDate(when.getDate() + addDays);
  when.setHours(hour, 0, 0, 0);
  return when;
}

/** The next Monday strictly after today; today counts as "this" Monday, not "next". */
function nextMonday(from: Date): Date {
  const days = ((8 - from.getDay()) % 7) || 7;
  return atHour(from, days, 9);
}

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { id: 'hour', label: 'In an hour', at: (now) => new Date(now.getTime() + 3_600_000) },
  {
    id: 'this-evening',
    label: 'This evening',
    // Only offered while it is still ahead — see `presetsFor`.
    at: (now) => atHour(now, 0, 18),
  },
  { id: 'tomorrow', label: 'Tomorrow at 9:00', at: (now) => atHour(now, 1, 9) },
  { id: 'monday', label: 'Monday at 9:00', at: nextMonday },
];

/** The presets that are still in the future, which is the only kind worth offering. */
export function presetsFor(now: Date): SchedulePreset[] {
  // A minute of headroom: the server refuses anything under thirty seconds away, and a
  // preset that appears and then fails is worse than one that is not offered.
  const floor = now.getTime() + 60_000;
  return SCHEDULE_PRESETS.filter((preset) => preset.at(now).getTime() > floor);
}

/** The earliest a custom time may be, as `datetime-local` wants it.
 *
 * The control needs a local-clock string with no zone, while everything else here works
 * in Date objects — so the conversion lives beside the presets rather than being
 * rediscovered in the composer. A minute of headroom, matching `presetsFor`: the server
 * refuses anything under thirty seconds away.
 */
export function earliestCustom(now: Date): string {
  const floor = new Date(now.getTime() + 60_000);
  // toISOString would convert to UTC, which is the wrong clock for this control.
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${floor.getFullYear()}-${pad(floor.getMonth() + 1)}-${pad(floor.getDate())}` +
    `T${pad(floor.getHours())}:${pad(floor.getMinutes())}`
  );
}

/** What a schedule may repeat as. Mirrors the server's list, and a CHECK constraint. */
export const REPEAT_OPTIONS: ReadonlyArray<{
  value: ScheduleRepeat | '';
  label: string;
}> = [
  { value: '', label: 'Doesn’t repeat' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
];

/** How a repeating schedule reads in a list, beside the message it will send. */
export function describeRepeat(repeat: ScheduleRepeat | null): string | null {
  // Null is "once", which is the ordinary case and reads better as nothing at all than
  // as a label saying so.
  if (!repeat) return null;
  return REPEAT_OPTIONS.find((option) => option.value === repeat)?.label ?? null;
}

/** The zone the author is actually in, which is the one "nine o'clock" is about.
 *
 * Sent with a recurring schedule and stored, because the next occurrence has to be
 * rebuilt from a wall clock at every send — a recurrence computed once in UTC drifts by
 * an hour twice a year, silently, and the standup reminder just starts arriving at eight.
 */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
