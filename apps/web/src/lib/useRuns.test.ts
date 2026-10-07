// @vitest-environment happy-dom
/** The run selectors: a running card's snapshots must move its own card and nothing else. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AgentRunView } from '@blob/shared';

vi.mock('./socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(),
    onStatus: vi.fn(),
  },
}));

const { useStore } = await import('./store.ts');
const { useBusyAgentNames, useRunIdsByMessage } = await import('./useRuns.ts');
const { applyRunEvent } = await import('./agentRuns.ts');

function run(id: string, overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id,
    pluginId: 'p1',
    agentName: 'Janus',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: 'm1',
    status: 'running',
    error: null,
    postCount: 0,
    startedAt: '2026-10-07T10:00:00.000Z',
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

const snapshot = {
  steps: [],
  tools: [],
  activity: 'reading',
  reasoning: null,
  textChars: 5,
  textTail: 'hello',
  dropped: 0,
};

beforeEach(() => {
  useStore.setState({ agentRuns: { r1: run('r1') } });
});

describe('which runs hang under which message', () => {
  it('stays the same object while a card streams, and moves when a run arrives', () => {
    const { result } = renderHook(() => useRunIdsByMessage('c1', null));
    const before = result.current;
    expect(before).toEqual({ m1: ['r1'] });

    act(() => {
      useStore
        .getState()
        .applyEvent({ t: 'agent_run.updated', runId: 'r1', channelId: 'c1', card: snapshot });
    });
    expect(result.current).toBe(before);

    act(() => {
      useStore.getState().applyEvent({ t: 'agent_run.started', run: run('r2') });
    });
    expect(result.current).toEqual({ m1: ['r1', 'r2'] });
  });

  it('keeps a thread reply’s run in its thread and out of the channel', () => {
    useStore.setState({
      agentRuns: { r1: run('r1'), r9: run('r9', { threadRootId: 'root', triggerMessageId: 'reply' }) },
    });
    const channel = renderHook(() => useRunIdsByMessage('c1', null));
    const thread = renderHook(() => useRunIdsByMessage(null, 'root'));
    expect(channel.result.current).toEqual({ m1: ['r1'] });
    expect(thread.result.current).toEqual({ reply: ['r9'] });
  });
});

describe('which agents are busy', () => {
  it('stays the same set while a card streams', () => {
    const { result } = renderHook(() => useBusyAgentNames());
    const before = result.current;
    expect([...before]).toEqual(['Janus']);
    act(() => {
      useStore
        .getState()
        .applyEvent({ t: 'agent_run.updated', runId: 'r1', channelId: 'c1', card: snapshot });
    });
    expect(result.current).toBe(before);
  });
});

describe('a run frame', () => {
  it('changes nothing, and keeps the same object, for a run this client never saw', () => {
    const held = { r1: run('r1') };
    expect(
      applyRunEvent(held, { t: 'agent_run.updated', runId: 'nope', channelId: 'c1', card: snapshot }),
    ).toBe(held);
    expect(
      applyRunEvent(held, {
        t: 'agent_run.finished',
        runId: 'nope',
        channelId: 'c1',
        status: 'succeeded',
        error: null,
        postCount: 1,
      }),
    ).toBe(held);
  });
});
