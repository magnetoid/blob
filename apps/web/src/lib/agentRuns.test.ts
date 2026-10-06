import { describe, expect, it } from 'vitest';
import type { AgentRunView } from '@blob/shared';
import { foldFetchedRuns, mergeRun, runningIds } from './agentRuns.ts';

function run(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: 'r1',
    pluginId: 'p1',
    agentName: 'Janus',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: 'm1',
    status: 'running',
    error: null,
    postCount: 0,
    startedAt: '2026-10-06T10:00:00.000Z',
    finishedAt: null,
    card: null,
    chainId: 'm1',
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: 'u1',
    answeredAt: null,
    expiresAt: null,
    ...overrides,
  };
}

const LIVE_CARD = {
  steps: [{ name: 'read the thread', status: 'done' as const }],
  tools: [],
  activity: 'writing',
  reasoning: null,
  textChars: 120,
  dropped: 0,
};

describe('mergeRun', () => {
  it('never walks a finished run back to running', () => {
    // A list fetched before the run finished, landing after the frame that said so.
    const finished = run({ status: 'succeeded', finishedAt: '2026-10-06T10:01:00.000Z' });
    expect(mergeRun(finished, run())).toBe(finished);
  });

  it('takes a fetch that is further along than what is held', () => {
    // The frame that said it ended was missed while the socket was down.
    const fetched = run({ status: 'failed', error: 'the agent stopped answering' });
    expect(mergeRun(run(), fetched)).toEqual(fetched);
  });

  it('keeps the live card while both still say running', () => {
    // A running run's row has no card yet; the store has been drawing the live one.
    const merged = mergeRun(run({ card: LIVE_CARD }), run());
    expect(merged.card).toEqual(LIVE_CARD);
  });

  it('an answered decision does not go back to waiting', () => {
    const answered = run({ status: 'interrupted', answeredAt: '2026-10-06T10:05:00.000Z' });
    expect(mergeRun(answered, run({ status: 'interrupted' }))).toBe(answered);
  });
});

describe('foldFetchedRuns', () => {
  it('settles a run that ended while nobody was listening', () => {
    const held = { r1: run(), r2: run({ id: 'r2' }) };
    const folded = foldFetchedRuns(held, [run({ id: 'r2' })], { settle: runningIds(held) });
    expect(Object.keys(folded)).toEqual(['r2']);
  });

  it('leaves alone a run that started while the fetch was out', () => {
    // Not in the answer because the snapshot predates it, which says nothing.
    const before = runningIds({});
    const held = { r9: run({ id: 'r9' }) };
    const folded = foldFetchedRuns(held, [], { settle: before });
    expect(Object.keys(folded)).toEqual(['r9']);
  });

  it('settles nothing when the fetch cannot speak for every running run', () => {
    const held = { r1: run() };
    expect(Object.keys(foldFetchedRuns(held, []))).toEqual(['r1']);
  });
});
