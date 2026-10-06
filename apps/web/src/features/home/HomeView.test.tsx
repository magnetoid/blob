// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { AgentRunView } from '@blob/shared';

vi.mock('../../lib/api.ts', () => ({
  api: {
    agentRuns: { mine: vi.fn(async () => ({ runs: [] })) },
    agentic: { listTasks: vi.fn(async () => ({ tasks: [] })) },
    messages: { send: vi.fn() },
  },
}));

vi.mock('../../lib/navigation.ts', () => ({
  showChannel: vi.fn(),
  showThread: vi.fn(),
}));

const { useStore } = await import('../../lib/store.ts');
const { HomeView } = await import('./HomeView.tsx');

afterEach(cleanup);

beforeEach(() => {
  useStore.setState({
    workspaceName: 'Imba',
    currentUser: { id: 'u1', kind: 'human', displayName: 'Marko', role: 'owner', deactivated: false },
    users: {
      u1: { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false },
      b1: { id: 'b1', kind: 'bot', displayName: 'Blob', deactivated: false },
    },
    channels: {
      c1: {
        id: 'c1',
        kind: 'public',
        name: 'general',
        membership: { isStarred: false },
        hasUnread: true,
        mentionCount: 2,
        archivedAt: null,
      },
    },
    presence: {},
    agentRuns: {},
    channelTitle: (c: { name?: string | null }) => (c.name ? `#${c.name}` : 'channel'),
  } as never);
});

describe('HomeView', () => {
  it('is a live board, not a settings form', async () => {
    render(<HomeView />);
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy();
    expect(screen.getByLabelText('Ask the workspace agent')).toBeTruthy();
    expect(screen.getByText('Catch me up')).toBeTruthy();
    expect(await screen.findByText('#general')).toBeTruthy();
  });

  it('asks the resident agent, not whichever bot sorts first', () => {
    // The roster is alphabetical. "Alerts" is an app that is not in #general; a mention
    // aimed at it there is dropped silently. The seeded agent is the one to ask.
    useStore.setState({
      users: {
        u1: { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false },
        b0: { id: 'b0', kind: 'bot', displayName: 'Alerts', deactivated: false, agentResident: false },
        b1: { id: 'b1', kind: 'bot', displayName: 'Janus', deactivated: false, agentResident: true },
      },
    } as never);
    render(<HomeView />);
    expect(screen.getByPlaceholderText('Ask @Janus…')).toBeTruthy();
  });
});

function waitingOn(id: string, asker: string): AgentRunView {
  return {
    id,
    pluginId: 'p1',
    agentName: 'Janus',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: `m-${id}`,
    status: 'interrupted',
    error: null,
    postCount: 0,
    startedAt: '2026-10-06T10:00:00.000Z',
    finishedAt: '2026-10-06T10:00:05.000Z',
    card: null,
    chainId: `m-${id}`,
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: asker,
    answeredAt: null,
    expiresAt: null,
  };
}

describe('Needs a decision', () => {
  it('lists the decisions that are yours to make, and not somebody else\'s', () => {
    // Only the person a run is on behalf of may answer it. Every waiting run in every
    // room used to land here, and in the "Needs you" count, for everybody.
    useStore.setState({
      agentRuns: { mine: waitingOn('mine', 'u1'), theirs: waitingOn('theirs', 'u2') },
    } as never);
    render(<HomeView />);

    const section = screen.getByRole('heading', { name: 'Needs a decision' }).parentElement!;
    expect(within(section).getAllByText(/waiting for your answer/)).toHaveLength(1);
    expect(within(section).queryByText(/waiting for an answer/)).toBeNull();
  });
});
