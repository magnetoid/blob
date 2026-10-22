/** Where an agent stands, read from the runs a person can see (the Agents page).
 *
 * Its own module so the page file exports only components (fast refresh), and so the
 * rule is tested as the plain function it is.
 */

import type { AgentRunView } from '@blob/shared';

/** Where an agent stands, as one line: what it is doing, where, and since when. */
export type Standing =
  | { kind: 'working'; channelId: string }
  | { kind: 'waiting'; channelId: string }
  | { kind: 'returning'; channelId: string; at: string }
  | { kind: 'ran'; channelId: string; at: string }
  | { kind: 'quiet' };

/**
 * One agent's standing, from the runs you can see.
 *
 * Working beats waiting beats coming back beats having run: an agent busy in one channel
 * while a question of yours waits in another is, right now, working. Waiting counts only a
 * question that is yours to answer — somebody else's is not something you can do anything
 * about. Coming back is a follow-up it set (ADR 0040): asleep until its time, so not
 * working, and the soonest is the one worth naming.
 */
export function standingOf(
  runs: readonly AgentRunView[],
  pluginId: string,
  me: string | null,
): Standing {
  const its = runs.filter((run) => run.pluginId === pluginId);
  const newest = (a: AgentRunView, b: AgentRunView) => b.startedAt.localeCompare(a.startedAt);
  // Waiting on another agent's answer is working, from where anybody stands (M2 · A2).
  const working = its
    .filter((run) => run.status === 'running' || (run.status === 'waiting' && !run.comesBackAt))
    .sort(newest)[0];
  if (working) return { kind: 'working', channelId: working.channelId };
  const waiting = its
    .filter(
      (run) =>
        run.status === 'interrupted' && !run.answeredAt && me !== null && run.initiatedByUserId === me,
    )
    .sort(newest)[0];
  if (waiting) return { kind: 'waiting', channelId: waiting.channelId };
  const returning = its
    .filter((run) => run.status === 'waiting' && run.comesBackAt)
    .sort((a, b) => (a.comesBackAt ?? '').localeCompare(b.comesBackAt ?? ''))[0];
  if (returning?.comesBackAt) {
    return { kind: 'returning', channelId: returning.channelId, at: returning.comesBackAt };
  }
  const last = [...its].sort(newest)[0];
  if (last) return { kind: 'ran', channelId: last.channelId, at: last.finishedAt ?? last.startedAt };
  return { kind: 'quiet' };
}
