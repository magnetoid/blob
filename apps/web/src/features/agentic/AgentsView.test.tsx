// @vitest-environment happy-dom
/**
 * The Agents page: every agent you can ask, what it says it does, and where it stands.
 *
 * What these pin is that the standing line tells the truth from runs alone — working
 * beats waiting beats having run, and "waiting" means waiting for *you* — and that each
 * row offers what that person can actually do with that agent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgentRunView } from '@blob/shared';

vi.mock('../../lib/api.ts', () => ({
  api: {
    agents: { list: vi.fn() },
    agentRuns: { mine: vi.fn(async () => ({ runs: [] })), history: vi.fn() },
  },
}));

vi.mock('../../lib/navigation.ts', () => ({
  showChannel: vi.fn(),
  showDirectMessage: vi.fn(),
}));

vi.mock('../../lib/router.ts', async (original) => ({
  ...(await original<typeof import('../../lib/router.ts')>()),
  navigate: vi.fn(),
}));

const { api } = await import('../../lib/api.ts');
const { useStore } = await import('../../lib/store.ts');
const { AgentsView } = await import('./AgentsView.tsx');
const { standingOf } = await import('./standing.ts');
const { navigate } = await import('../../lib/router.ts');
const { showDirectMessage, showChannel } = await import('../../lib/navigation.ts');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function run(overrides: Partial<AgentRunView>): AgentRunView {
  return {
    id: 'r1',
    pluginId: 'p-janus',
    agentName: 'Janus',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: 'm1',
    status: 'succeeded',
    error: null,
    postCount: 1,
    startedAt: '2026-10-19T08:00:00.000Z',
    finishedAt: '2026-10-19T08:01:00.000Z',
    card: null,
    chainId: 'm1',
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: 'u1',
    tokens: null,
    answeredAt: null,
    expiresAt: null,
    seen: null,
    decision: null,
    ...overrides,
  } as AgentRunView;
}

const AGENTS = [
  {
    id: 'p-janus',
    name: 'Janus',
    botUserId: 'b-janus',
    mine: false,
    lent: false,
    description: 'Answers questions about the workspace.',
    online: null,
  },
  { id: 'p-pip', name: 'Pip', botUserId: 'b-pip', mine: true, lent: false, description: null, online: true },
  { id: 'p-lent', name: 'Scout', botUserId: 'b-scout', mine: false, lent: true, description: null, online: null },
];

beforeEach(() => {
  vi.mocked(api.agents.list).mockResolvedValue({ agents: AGENTS } as never);
  useStore.setState({
    currentUser: { id: 'u1', kind: 'human', displayName: 'Marko', role: 'member', deactivated: false },
    users: {
      u1: { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false },
      'b-janus': { id: 'b-janus', kind: 'bot', displayName: 'Janus', deactivated: false },
    },
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', membership: { isStarred: false }, archivedAt: null },
      c2: { id: 'c2', kind: 'public', name: 'launch', membership: { isStarred: false }, archivedAt: null },
    },
    agentRuns: {},
    channelTitle: (c: { name?: string | null }) => (c.name ? `#${c.name}` : 'channel'),
  } as never);
});

describe('where an agent stands', () => {
  it('is working when any run is, wherever its question is waiting', () => {
    const runs = [
      run({ id: 'a', status: 'interrupted', channelId: 'c1', startedAt: '2026-10-19T09:00:00.000Z' }),
      run({ id: 'b', status: 'running', channelId: 'c2', startedAt: '2026-10-19T08:00:00.000Z' }),
    ];
    expect(standingOf(runs, 'p-janus', 'u1')).toEqual({ kind: 'working', channelId: 'c2' });
  });

  it('is waiting only on a question that is yours to answer', () => {
    const theirs = run({ status: 'interrupted', initiatedByUserId: 'u2' });
    expect(standingOf([theirs], 'p-janus', 'u1').kind).toBe('ran');
    const yours = run({ status: 'interrupted', initiatedByUserId: 'u1' });
    expect(standingOf([yours], 'p-janus', 'u1')).toEqual({ kind: 'waiting', channelId: 'c1' });
    const answered = run({ status: 'interrupted', answeredAt: '2026-10-19T08:02:00.000Z' });
    expect(standingOf([answered], 'p-janus', 'u1').kind).toBe('ran');
  });

  it('otherwise says when it last ran, and where', () => {
    const runs = [
      run({ id: 'old', channelId: 'c1', startedAt: '2026-10-19T07:00:00.000Z' }),
      run({ id: 'new', channelId: 'c2', startedAt: '2026-10-19T09:00:00.000Z', finishedAt: '2026-10-19T09:05:00.000Z' }),
    ];
    expect(standingOf(runs, 'p-janus', 'u1')).toEqual({
      kind: 'ran',
      channelId: 'c2',
      at: '2026-10-19T09:05:00.000Z',
    });
    expect(standingOf(runs, 'p-other', 'u1')).toEqual({ kind: 'quiet' });
  });
});

describe('the page', () => {
  it('lists each agent with whose it is and what it does', async () => {
    render(<AgentsView />);
    const list = await screen.findByRole('list', { name: 'Agents' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('The workspace’s')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Answers questions about the workspace.')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Yours')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Lent to you')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('It has not said what it does.')).toBeTruthy();
  });

  it('reads its standing from the runs the store keeps, and links to the room', async () => {
    useStore.setState({
      agentRuns: { r1: run({ id: 'r1', status: 'running', channelId: 'c2' }) },
    } as never);
    render(<AgentsView />);
    const list = await screen.findByRole('list', { name: 'Agents' });
    const janus = within(list).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(janus).getByText(/Working in/)).toBeTruthy();
    fireEvent.click(within(janus).getByRole('button', { name: '#launch' }));
    expect(showChannel).toHaveBeenCalledWith('c2');
    const pip = within(list).getAllByRole('listitem')[1] as HTMLElement;
    expect(within(pip).getByText('Nothing in the last day')).toBeTruthy();
  });

  it('offers a message to each, and settings only where this person may change them', async () => {
    render(<AgentsView />);
    const list = await screen.findByRole('list', { name: 'Agents' });
    const [janus, pip, scout] = within(list).getAllByRole('listitem') as HTMLElement[];
    fireEvent.click(within(janus as HTMLElement).getByRole('button', { name: 'Message' }));
    expect(showDirectMessage).toHaveBeenCalledWith('b-janus');
    // A member does not configure the workspace's agent or a borrowed one; their own, yes.
    expect(within(janus as HTMLElement).queryByRole('button', { name: 'Settings' })).toBeNull();
    expect(within(scout as HTMLElement).queryByRole('button', { name: 'Settings' })).toBeNull();
    fireEvent.click(within(pip as HTMLElement).getByRole('button', { name: 'Settings' }));
    expect(navigate).toHaveBeenCalledWith('/settings/my-agents');
  });

  it('sends an admin to the console for the workspace’s agent', async () => {
    useStore.setState({
      currentUser: { id: 'u1', kind: 'human', displayName: 'Marko', role: 'admin', deactivated: false },
    } as never);
    render(<AgentsView />);
    const list = await screen.findByRole('list', { name: 'Agents' });
    const janus = within(list).getAllByRole('listitem')[0] as HTMLElement;
    fireEvent.click(within(janus).getByRole('button', { name: 'Settings' }));
    expect(navigate).toHaveBeenCalledWith('/admin/apps/p-janus');
  });

  it('says so when there is nobody to ask', async () => {
    vi.mocked(api.agents.list).mockResolvedValue({ agents: [] } as never);
    render(<AgentsView />);
    await waitFor(() => expect(screen.getByText('No agents you can ask yet')).toBeTruthy());
  });
});
