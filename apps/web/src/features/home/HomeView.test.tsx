// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

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
});
