/**
 * Calls, as the store folds them: the frame types a call event comes as, the pure
 * reducer over the live list, and the replay lists every `loadCalls` in flight keeps.
 * Split out of `store.ts`; the load sequencing that reassigns module state stays there.
 */

import type { Call, ServerEvent } from "@blob/shared";

/** The `call.started | call.updated | call.ended` members of the server event union —
 *  what `reduceCalls` and a `loadCalls` replay both fold over. */
export type CallFrame = Extract<ServerEvent, { t: "call.started" | "call.updated" | "call.ended" }>;

export type CallsSettingsFrame = Extract<ServerEvent, { t: "calls.settings" }>;

/**
 * One call frame folded over the live list. Pure, and the same object back when nothing
 * changed — an update or an end for a call this client never heard start is not invented
 * into one — which is what lets `applyEvent` skip a re-render for it.
 */
export function reduceCalls(calls: Record<string, Call>, frame: CallFrame): Record<string, Call> {
  switch (frame.t) {
    case "call.started":
      return { ...calls, [frame.call.id]: frame.call };
    case "call.updated": {
      const call = calls[frame.callId];
      if (!call) return calls;
      return {
        ...calls,
        [frame.callId]: { ...call, participantIds: frame.participantIds },
      };
    }
    case "call.ended": {
      if (!calls[frame.callId]) return calls;
      const next = { ...calls };
      delete next[frame.callId];
      return next;
    }
  }
}

/**
 * Every `loadCalls` in flight, each as the list of call frames it has heard since it
 * started. Its own request answers with a snapshot that can be older than a frame the
 * socket delivered while the snapshot was on its way — an ended call must not come back,
 * a started one must not vanish — so `applyEvent` records every frame here before applying
 * it, and `loadCalls` replays its own list over the snapshot it got back. A set because a
 * mount and a resync can each have a `loadCalls` outstanding at once, and each needs its
 * own replay.
 */
export const callLoads = new Set<Array<CallFrame | CallsSettingsFrame>>();
