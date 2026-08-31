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
