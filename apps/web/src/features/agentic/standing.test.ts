/** Where an agent stands, read from its runs (A4): waiting on another agent's answer is
 * working, from where anybody stands (M2 · A2). */
import { describe, expect, it } from 'vitest';
import type { AgentRunView } from '@blob/shared';
import { standingOf } from './standing.ts';

function run(overrides: Partial<AgentRunView>): AgentRunView {
  return {
    id: 'r1',
    pluginId: 'p1',
    agentName: 'Planner',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: 'm1',
    status: 'succeeded',
    error: null,
    postCount: 1,
    startedAt: '2026-10-20T10:00:00.000Z',
    finishedAt: '2026-10-20T10:00:05.000Z',
    card: null,
    chainId: 'm0',
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: 'u1',
    answeredAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('standing', () => {
  it('counts a run waiting on another agent as working, where it waits', () => {
    expect(standingOf([run({ status: 'waiting', channelId: 'c9' })], 'p1', 'u1')).toEqual({
      kind: 'working',
      channelId: 'c9',
    });
  });

  it('still counts a question for the person as theirs to answer', () => {
    expect(standingOf([run({ status: 'interrupted' })], 'p1', 'u1').kind).toBe('waiting');
  });
});

describe('coming back later (ADR 0040)', () => {
  it('is not working — it is asleep until its time — and the soonest is named', () => {
    const runs = [
      run({ id: 'a', status: 'waiting', channelId: 'c2', comesBackAt: '2026-10-25T09:00:00.000Z' }),
      run({ id: 'b', status: 'waiting', channelId: 'c3', comesBackAt: '2026-10-24T09:00:00.000Z' }),
    ];
    expect(standingOf(runs, 'p1', 'u1')).toEqual({
      kind: 'returning',
      channelId: 'c3',
      at: '2026-10-24T09:00:00.000Z',
    });
  });

  it('yields to work, and to a question that is yours to answer', () => {
    const back = run({ id: 'a', status: 'waiting', comesBackAt: '2026-10-24T09:00:00.000Z' });
    expect(standingOf([back, run({ id: 'b', status: 'running' })], 'p1', 'u1').kind).toBe('working');
    expect(standingOf([back, run({ id: 'c', status: 'interrupted' })], 'p1', 'u1').kind).toBe(
      'waiting',
    );
  });
});
