// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

// Partial: the rest of what the router exports is real, `navigate` is recorded.
vi.mock('../../lib/router.ts', async (original) => ({
  ...(await original<typeof import('../../lib/router.ts')>()),
  navigate: vi.fn(),
}));

const { useStore } = await import('../../lib/store.ts');
const { HomeView } = await import('./HomeView.tsx');
const { navigate } = await import('../../lib/router.ts');

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

  it('counts what a card holds beside its heading, and shows no count for none', () => {
    // The count is a sibling of the heading, so the heading's name stays its words; and
    // an empty card says so in its own line rather than with a "0" chip as well.
    useStore.setState({
      agentRuns: { mine: waitingOn('mine', 'u1'), theirs: waitingOn('theirs', 'u2') },
    } as never);
    render(<HomeView />);

    const decisions = screen.getByRole('heading', { name: 'Needs a decision' }).parentElement!;
    expect(decisions.querySelector('.home-card-count')?.textContent).toBe('1');
    const live = screen.getByRole('heading', { name: 'Agents live' }).parentElement!;
    expect(live.querySelector('.home-card-count')).toBeNull();
  });
});

describe('where you stand', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('greets you by the hour and your first name, and says it in a sentence', () => {
    // One unread channel with two mentions, nothing waiting on you.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 8, 9, 30));
    useStore.setState({
      currentUser: { id: 'u1', kind: 'human', displayName: 'Marko Ilic', role: 'owner', deactivated: false },
    } as never);
    render(<HomeView />);

    expect(screen.getByText('Good morning, Marko')).toBeTruthy();
    expect(screen.getByText('2 mentions and 1 conversation with something new.')).toBeTruthy();
  });

  it('says so when there is nothing at all', () => {
    useStore.setState({ channels: {} } as never);
    render(<HomeView />);
    expect(screen.getByText('You are all caught up.')).toBeTruthy();
  });

  it('is still evening after midnight', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 9, 1, 15));
    render(<HomeView />);
    expect(screen.getByText('Good evening, Marko')).toBeTruthy();
  });
});

describe('the numbers lead somewhere', () => {
  it('takes you down this page to what needs you: a decision first, then your mentions', () => {
    // "Needs you" counts decisions as well as mentions, and the mentions page cannot show
    // a decision — so it stays here, where both are.
    vi.mocked(navigate).mockClear();
    useStore.setState({ agentRuns: { mine: waitingOn('mine', 'u1') } } as never);
    render(<HomeView />);

    fireEvent.click(screen.getByRole('button', { name: /Needs you/ }));
    const decisions = screen.getByRole('heading', { name: 'Needs a decision' }).parentElement;
    expect(document.activeElement).toBe(decisions);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('goes to the unread mentions when no decision is waiting', () => {
    // The seeded #general has two mentions and nothing is waiting on you.
    render(<HomeView />);
    fireEvent.click(screen.getByRole('button', { name: /Needs you/ }));
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Unread' }).parentElement,
    );
  });

  it('is a number and not a button when nothing needs you', () => {
    useStore.setState({ channels: {} } as never);
    render(<HomeView />);
    expect(screen.queryByRole('button', { name: /Needs you/ })).toBeNull();
  });

  it('opens your tasks from "Open tasks"', () => {
    vi.mocked(navigate).mockClear();
    render(<HomeView />);
    fireEvent.click(screen.getByRole('button', { name: /Open tasks/ }));
    expect(navigate).toHaveBeenLastCalledWith('/tasks');
  });

  it('leaves a number with nowhere to go as a number, not a button', () => {
    render(<HomeView />);
    expect(screen.queryByRole('button', { name: /Here now/ })).toBeNull();
    expect(screen.getByText('Here now')).toBeTruthy();
  });
});
