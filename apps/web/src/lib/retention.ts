/** How long a workspace keeps things (ADR 0039), in the words a page shows. */

import type { RetentionNotice } from '@blob/shared';

/** The windows the Retention page offers; any other number of days is shown as itself. */
export const WINDOWS: readonly { days: number; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: '1 year' },
  { days: 730, label: '2 years' },
  { days: 1095, label: '3 years' },
  { days: 1825, label: '5 years' },
  { days: 2555, label: '7 years' },
];

/** "90 days", "1 year", "40 days". */
export function windowLabel(days: number): string {
  return WINDOWS.find((w) => w.days === days)?.label ?? (days === 1 ? '1 day' : `${days} days`);
}

/**
 * What a conversation's members are told about how long it keeps things, or null when
 * the workspace keeps everything and the conversation is not held. A person's own hold
 * is theirs and is not named here: the rule says "or someone in it" for everybody.
 */
export function keptFor(retention: RetentionNotice | null, heldAt: string | null): string | null {
  if (heldAt) {
    const since = new Date(heldAt).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    return `On legal hold since ${since}: kept past this workspace’s retention.`;
  }
  const messages = retention?.messageDays ?? null;
  const files = retention?.fileDays ?? null;
  if (messages === null && files === null) return null;
  const parts: string[] = [];
  if (messages !== null) parts.push(`messages after ${windowLabel(messages)}`);
  if (files !== null && (messages === null || files < messages)) {
    parts.push(`files after ${windowLabel(files)}`);
  }
  return `This workspace removes ${parts.join(' and ')}, unless the conversation or someone in it is on legal hold.`;
}
