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
    ...overrides,
  };
}

beforeEach(() => {
  useStore.setState({ agentRuns: {} });
  useToasts.setState({ toasts: [] });
});

describe('agent run events', () => {
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
