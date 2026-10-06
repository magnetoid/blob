/** Folding what the server says about runs into what the store already knows.
 *
 * Runs reach the store two ways: live frames on the socket, and fetches — a channel's
 * list when it opens, Home's list, and the refetch after a reconnect. A fetch is a
 * snapshot taken some time before it lands, so it can be older than a frame that arrived
 * while it was in flight. Merged blindly, a list fetched before a run finished put it
 * back to `running`, and no further frame was coming to correct it: a spinner and a Stop
 * button for a run that was over, and a Stop that answered 404.
 *
 * A run only ever moves forward — running, then waiting for an answer, then answered or
 * over — so the rule is to take whichever view is further along.
 */

import type { AgentRunView } from '@blob/shared';

/** How far along a run is. A view never replaces one that is further along. */
export function runProgress(run: AgentRunView): number {
  if (run.status === 'running') return 0;
  if (run.status === 'interrupted') return run.answeredAt ? 2 : 1;
  return 3;
}

/**
 * The view to keep when a fetched one meets one already held.
 *
 * The card is the exception to taking the fetched view whole: a run's card is written to
 * its row only when it finishes, so a fetch of a running run carries none, while the
 * store has been drawing live snapshots of it.
 */
export function mergeRun(held: AgentRunView | undefined, fetched: AgentRunView): AgentRunView {
  if (!held) return fetched;
  if (runProgress(fetched) < runProgress(held)) return held;
  return { ...fetched, card: fetched.card ?? held.card };
}

export interface FoldOptions {
  /**
   * Runs the fetch can speak for: ones held as `running` when it was sent, by a fetch
   * that lists every run still going that this person can see. Any of them it leaves
   * out has ended. A run that started while the fetch was out is not among them — the
   * snapshot predates it, so its absence says nothing.
   */
  settle?: ReadonlySet<string>;
}

/** `held` with every fetched run merged in, and — when the fetch can tell — runs that
 *  stopped while nobody was listening taken out rather than left spinning. */
export function foldFetchedRuns(
  held: Record<string, AgentRunView>,
  fetched: AgentRunView[],
  { settle }: FoldOptions = {},
): Record<string, AgentRunView> {
  const next: Record<string, AgentRunView> = { ...held };
  const seen = new Set<string>();
  for (const run of fetched) {
    seen.add(run.id);
    next[run.id] = mergeRun(held[run.id], run);
  }
  if (settle) {
    // What it ended as is not known here, and inventing an outcome would be worse than
    // drawing none: the card goes, and the conversation still shows whatever was posted.
    for (const id of settle) {
      if (!seen.has(id) && next[id]?.status === 'running') delete next[id];
    }
  }
  return next;
}

/** The runs held as `running` right now: what a refetch sent now may settle. */
export function runningIds(held: Record<string, AgentRunView>): Set<string> {
  return new Set(
    Object.values(held)
      .filter((run) => run.status === 'running')
      .map((run) => run.id),
  );
}

/** How many runs `GET /api/agent-runs` returns at most; a list this long may be cut. */
export const MINE_LIMIT = 40;
