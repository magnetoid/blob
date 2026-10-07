// @vitest-environment happy-dom
/** Agent runs and reminders through applyEvent — the socket half of run cards. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunView } from '@blob/shared';

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return { ...actual };
});

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
const { useToasts } = await import('./toasts.ts');

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
    startedAt: new Date().toISOString(),
    finishedAt: null,
    card: null,
    chainId: 'm1',
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: 'u-asker',
    answeredAt: null,
    expiresAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  useStore.setState({ agentRuns: {} });
  useToasts.setState({ toasts: [] });
});

describe('agent run events', () => {
  it('a second started for the same run replaces the view — how answeredAt lands', () => {
    // `agent_run.started` is an upsert: the server re-sends the whole view when a waiting
    // run is answered, because the finished event has no room for the new fields.
    useStore.getState().applyEvent({ t: 'agent_run.started', run: run({ status: 'interrupted' }) });
    useStore.getState().applyEvent({
      t: 'agent_run.started',
      run: run({ status: 'interrupted', answeredAt: '2026-09-05T10:01:00.000Z' }),
    });

    expect(useStore.getState().agentRuns['r1']?.answeredAt).toBe('2026-09-05T10:01:00.000Z');
    expect(Object.keys(useStore.getState().agentRuns)).toHaveLength(1);
  });

  it('started registers the run; updated attaches the card', () => {
    useStore.getState().applyEvent({ t: 'agent_run.started', run: run() });
    expect(useStore.getState().agentRuns['r1']?.status).toBe('running');

    useStore.getState().applyEvent({
      t: 'agent_run.updated',
      runId: 'r1',
      channelId: 'c1',
      card: {
        steps: [{ name: 'think', status: 'running' }],
        tools: [],
        activity: null,
        reasoning: null,
        textChars: 0,
        dropped: 0,
      },
    });
    expect(useStore.getState().agentRuns['r1']?.card?.steps).toHaveLength(1);
  });

  it('an update for an unknown run is ignored, not invented', () => {
    useStore.getState().applyEvent({
      t: 'agent_run.updated',
      runId: 'ghost',
      channelId: 'c1',
      card: { steps: [], tools: [], activity: null, reasoning: null, textChars: 0, dropped: 0 },
    });
    expect(useStore.getState().agentRuns['ghost']).toBeUndefined();
  });

  it('finished settles status and keeps the card', () => {
    useStore.getState().applyEvent({ t: 'agent_run.started', run: run() });
    useStore.getState().applyEvent({
      t: 'agent_run.finished',
      runId: 'r1',
      channelId: 'c1',
      status: 'cancelled',
      error: null,
      postCount: 0,
    });
    const settled = useStore.getState().agentRuns['r1'];
    expect(settled?.status).toBe('cancelled');
    expect(settled?.finishedAt).not.toBeNull();
  });
});

describe('after a reconnect', () => {
  it('asks what the runs are doing now, and settles what the socket missed', async () => {
    // A run that finished while the socket was down kept its spinner and its Stop, and
    // the Stop answered 404; one that ended long enough ago is gone from the server's
    // list of live runs, which names every running one.
    const { api } = await import('./api.ts');
    useStore.setState({
      agentRuns: { r1: run(), r2: run({ id: 'r2', triggerMessageId: 'm2' }) },
    });
    const mine = vi
      .spyOn(api.agentRuns, 'mine')
      .mockResolvedValue({ runs: [run({ status: 'succeeded', finishedAt: '2026-10-06T10:01:00Z' })] });

    await useStore.getState().reloadRuns();

    expect(mine).toHaveBeenCalledTimes(1);
    expect(useStore.getState().agentRuns['r1']?.status).toBe('succeeded');
    expect(useStore.getState().agentRuns['r2']).toBeUndefined();
  });

  it('a list fetched before a run finished does not put it back to running', () => {
    useStore.getState().applyEvent({ t: 'agent_run.started', run: run() });
    useStore.getState().applyEvent({
      t: 'agent_run.finished',
      runId: 'r1',
      channelId: 'c1',
      status: 'succeeded',
      error: null,
      postCount: 1,
    });

    useStore.getState().foldRuns([run()]);

    expect(useStore.getState().agentRuns['r1']?.status).toBe('succeeded');
  });
});

describe('reminders', () => {
  it('a due reminder becomes a toast', () => {
    useStore.getState().applyEvent({
      t: 'reminder.due',
      messageId: 'm1',
      channelId: 'c1',
      note: 'circle back',
    });
    expect(useToasts.getState().toasts.map((t) => t.text)).toContain('Reminder: circle back');
  });
});

describe('task frames', () => {
  it('move the version of the thread a task is in, or of its channel when it has none', () => {
    // The thread panel refetches its tasks when this moves — how a task handed to an
    // agent shows done the moment the agent answers.
    useStore.setState({ taskVersions: {} });
    const { applyEvent } = useStore.getState();
    applyEvent({ t: 'task.updated', taskId: 't1', channelId: 'c1', threadRootId: 'm1', status: 'in_progress' });
    applyEvent({ t: 'task.updated', taskId: 't1', channelId: 'c1', threadRootId: 'm1', status: 'done' });
    applyEvent({ t: 'task.updated', taskId: 't2', channelId: 'c1', threadRootId: null, status: 'todo' });
    expect(useStore.getState().taskVersions).toEqual({ m1: 2, c1: 1 });
  });
});
