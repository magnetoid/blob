/** The run cards' view of the store: one run by id, and which runs hang under which
 * message.
 *
 * A running card sends a snapshot up to four times a second, and each one replaces that
 * run's object in `agentRuns`. Five screens subscribed to the whole map, so every snapshot
 * redrew the channel, the thread, Home, the work panel and the sidebar — for a card that
 * was, at most, on one of them. These select what each actually draws: a card its own run,
 * a list only *which* runs sit under which message, and the sidebar only which agents are
 * busy. A snapshot then redraws the one card it is for.
 */

import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { AgentRunView } from '@blob/shared';
import { useStore } from './store.ts';

/** One run, by id — what a card subscribes to. */
export function useRun(runId: string): AgentRunView | undefined {
  return useStore((s) => s.agentRuns[runId]);
}

/**
 * The runs under each message of one conversation, as ids, oldest first.
 *
 * `threadRootId` null is the channel itself: runs a top-level message started. A thread
 * reply's run anchors in the thread panel instead, because the reply is not in channel
 * history. Stable across card snapshots — it changes only when a run appears or goes.
 */
export function useRunIdsByMessage(
  channelId: string | null,
  threadRootId: string | null,
): Record<string, string[]> {
  const pairs = useStore(
    useShallow((s) => {
      if (!channelId && !threadRootId) return [] as string[];
      const out: string[] = [];
      for (const run of Object.values(s.agentRuns)) {
        if (!run.triggerMessageId) continue;
        const here = threadRootId
          ? run.threadRootId === threadRootId
          : run.channelId === channelId && !run.threadRootId;
        if (here) out.push(`${run.triggerMessageId}\u0000${run.id}`);
      }
      // Ids are UUIDv7: sorting the pairs orders each message's runs oldest first.
      return out.sort();
    }),
  );
  return useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const pair of pairs) {
      const [messageId = '', runId = ''] = pair.split('\u0000');
      (map[messageId] ??= []).push(runId);
    }
    return map;
  }, [pairs]);
}

/** The ids of runs `pick` keeps, in the order `order` gives — for a list of cards that
 *  should redraw when a run joins or leaves it, not when one of them moves. */
export function useRunIds(
  pick: (run: AgentRunView) => boolean,
  order: (a: AgentRunView, b: AgentRunView) => number,
): string[] {
  return useStore(
    useShallow((s) =>
      Object.values(s.agentRuns)
        .filter(pick)
        .sort(order)
        .map((run) => run.id),
    ),
  );
}

/** Which agents are running anything right now, by display name — what the sidebar's
 *  pulse needs, and all it needs. */
export function useBusyAgentNames(): ReadonlySet<string> {
  const names = useStore(
    useShallow((s) => {
      const busy = new Set<string>();
      for (const run of Object.values(s.agentRuns)) {
        if (run.status === 'running') busy.add(run.agentName);
      }
      return [...busy].sort();
    }),
  );
  return useMemo(() => new Set(names), [names]);
}
