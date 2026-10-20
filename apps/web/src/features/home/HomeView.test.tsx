// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AgentRunView, AgentTask } from '@blob/shared';

vi.mock('../../lib/api.ts', () => ({
  api: {
    agentRuns: { mine: vi.fn(async () => ({ runs: [] })), answer: vi.fn() },
    agentic: { listTasks: vi.fn(async () => ({ tasks: [] })), updateTask: vi.fn() },
    channels: { markAllRead: vi.fn(async () => ({ readStates: [] })) },
    messages: { send: vi.fn() },
    decisions: { list: vi.fn(async () => ({ decisions: [] })) },
  },
}));

vi.mock('../../lib/toasts.ts', () => ({ showError: vi.fn() }));

vi.mock('../../lib/navigation.ts', () => ({
  showChannel: vi.fn(),
  showThread: vi.fn(),
  showMessage: vi.fn(async () => true),
}));

// Partial: the rest of what the router exports is real, `navigate` is recorded.
vi.mock('../../lib/router.ts', async (original) => ({
  ...(await original<typeof import('../../lib/router.ts')>()),
  navigate: vi.fn(),
}));

const { useStore } = await import('../../lib/store.ts');
const { HomeView, CONFIRM_MS } = await import('./HomeView.tsx');
const { navigate } = await import('../../lib/router.ts');
const { api } = await import('../../lib/api.ts');
const { showError } = await import('../../lib/toasts.ts');
const { FALLBACK_MS } = await import('../../lib/usePresence.ts');

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
    // Each part of the sentence is a link now; the sentence still reads as one.
    expect(document.querySelector('.home-summary')?.textContent).toBe(
      '2 mentions and 1 conversation with something new.',
    );
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


function asking(
  id: string,
  asker: string,
  decision: { prompt: string; choices: Array<{ label: string }>; freeText: boolean } = {
    prompt: 'Two PRs are unreviewed. Hold the launch until they merge?',
    choices: [{ label: 'Hold' }, { label: 'Ship anyway' }],
    freeText: false,
  },
): AgentRunView {
  return { ...waitingOn(id, asker), decision } as AgentRunView;
}

function task(id: string, title: string, overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id,
    channelId: 'c1',
    threadRootId: null,
    title,
    instructions: '',
    status: 'todo',
    priority: 'medium',
    dueAt: null,
    completedAt: null,
    outcome: null,
    externalRef: {},
    createdAt: '2026-10-18T10:00:00.000Z',
    updatedAt: '2026-10-18T10:00:00.000Z',
    ...overrides,
  } as AgentTask;
}

function decisionsCard(): HTMLElement {
  return screen.getByRole('heading', { name: 'Needs a decision' }).parentElement as HTMLElement;
}

describe('answering on Home', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.agentRuns.answer).mockReset();
    vi.mocked(showError).mockClear();
  });

  it('shows the question and its choices, answers here, says so, then leaves for good', async () => {
    vi.mocked(api.agentRuns.answer).mockResolvedValue({ ok: true });
    useStore.setState({ agentRuns: { q: asking('q', 'u1') } } as never);
    render(<HomeView />);

    const card = decisionsCard();
    expect(within(card).getByText('Two PRs are unreviewed. Hold the launch until they merge?')).toBeTruthy();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const choices = within(card).getByRole('group', { name: 'Answer Janus' });
    await act(async () => {
      fireEvent.click(within(choices).getByRole('button', { name: 'Ship anyway' }));
    });

    // By the choice's place, as its button under the message would be.
    expect(api.agentRuns.answer).toHaveBeenCalledWith('q', { choice: 1 }, expect.any(String));
    expect(within(card).getByRole('status').textContent).toContain('Answered “Ship anyway”.');
    expect(within(card).getByText('Two PRs are unreviewed. Hold the launch until they merge?')).toBeTruthy();
    // Already off the count: it no longer needs you.
    expect(card.querySelector('.home-card-count')).toBeNull();

    // Two beats, as they happen: the confirmation's time runs out and the row starts to
    // close; then the close ends (here by its fallback — no transition runs in a test).
    await act(async () => {
      vi.advanceTimersByTime(CONFIRM_MS + 10);
    });
    await act(async () => {
      vi.advanceTimersByTime(FALLBACK_MS + 10);
    });
    // And it stays gone, though the store has not yet heard the run was answered.
    expect(within(decisionsCard()).getByText('Nothing waiting.')).toBeTruthy();
    expect(useStore.getState().agentRuns.q?.answeredAt).toBeNull();
  });

  it('takes words when the question asks for words', async () => {
    vi.mocked(api.agentRuns.answer).mockResolvedValue({ ok: true });
    useStore.setState({
      agentRuns: {
        q: asking('q', 'u1', { prompt: 'What should the notes lead with?', choices: [], freeText: true }),
      },
    } as never);
    render(<HomeView />);

    const box = screen.getByRole('textbox', { name: 'Answer Janus' });
    fireEvent.change(box, { target: { value: 'The pricing change' } });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    expect(api.agentRuns.answer).toHaveBeenCalledWith('q', { value: 'The pricing change' }, expect.any(String));
    expect(within(decisionsCard()).getByRole('status').textContent).toContain('Answered in your own words.');

    // Typed, so the keyboard's: when the row has gone, focus is on the card it was in
    // rather than thrown back to the top of the page.
    await act(async () => {
      vi.advanceTimersByTime(CONFIRM_MS + 10);
    });
    await act(async () => {
      vi.advanceTimersByTime(FALLBACK_MS + 10);
    });
    expect(document.activeElement).toBe(decisionsCard());
  });

  it('leaves the question as it was when the answer does not go through', async () => {
    vi.mocked(api.agentRuns.answer).mockRejectedValue(new Error('The run is no longer waiting.'));
    useStore.setState({ agentRuns: { q: asking('q', 'u1') } } as never);
    render(<HomeView />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    });
    expect(showError).toHaveBeenCalled();
    expect(within(decisionsCard()).queryByRole('status')).toBeNull();
    expect((screen.getByRole('button', { name: 'Hold' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the way to the conversation when there is no question it can draw', () => {
    useStore.setState({ agentRuns: { q: waitingOn('q', 'u1') } } as never);
    render(<HomeView />);
    expect(within(decisionsCard()).getByRole('button', { name: 'Answer in #general' })).toBeTruthy();
  });
});

describe('your tasks on Home', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(api.agentic.listTasks).mockReset();
    vi.mocked(api.agentic.listTasks).mockResolvedValue({ tasks: [] });
    vi.mocked(api.agentic.updateTask).mockReset();
  });

  it('ticks one off in place: checked, struck through, then gone, and the counts follow', async () => {
    vi.mocked(api.agentic.listTasks).mockResolvedValue({
      tasks: [task('t1', 'Write the notes', { priority: 'high' }), task('t2', 'Book the retro')],
    });
    vi.mocked(api.agentic.updateTask).mockResolvedValue({ task: task('t1', 'Write the notes', { status: 'done' }) });
    render(<HomeView />);

    const box = await screen.findByRole('checkbox', { name: 'Mark “Write the notes” done' });
    expect(screen.getByText('high')).toBeTruthy();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.click(box);
    });
    expect(api.agentic.updateTask).toHaveBeenCalledWith('t1', { status: 'done' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    const tasksCard = screen.getByRole('heading', { name: 'Your tasks' }).parentElement as HTMLElement;
    expect(tasksCard.querySelector('.home-card-count')?.textContent).toBe('1');

    // Two beats, as they happen: the confirmation's time runs out and the row starts to
    // close; then the close ends (here by its fallback — no transition runs in a test).
    await act(async () => {
      vi.advanceTimersByTime(CONFIRM_MS + 10);
    });
    await act(async () => {
      vi.advanceTimersByTime(FALLBACK_MS + 10);
    });
    expect(screen.queryByRole('checkbox', { name: 'Mark “Write the notes” done' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Mark “Book the retro” done' })).toBeTruthy();
  });

  it('unticks it again, and says why, when the change does not go through', async () => {
    vi.mocked(api.agentic.listTasks).mockResolvedValue({ tasks: [task('t1', 'Write the notes')] });
    vi.mocked(api.agentic.updateTask).mockRejectedValue(new Error('That task is gone.'));
    render(<HomeView />);

    const box = await screen.findByRole('checkbox', { name: 'Mark “Write the notes” done' });
    await act(async () => {
      fireEvent.click(box);
    });
    expect(showError).toHaveBeenCalled();
    expect(box.getAttribute('aria-checked')).toBe('false');
  });
});

describe('the rest of the board is something you can act on', () => {
  it('clears everything unread from the Unread card', async () => {
    render(<HomeView />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    });
    expect(api.channels.markAllRead).toHaveBeenCalled();
  });

  it('makes each part of the sentence the way to what it counts', () => {
    vi.mocked(navigate).mockClear();
    useStore.setState({ agentRuns: { q: asking('q', 'u1') } } as never);
    render(<HomeView />);

    fireEvent.click(screen.getByRole('button', { name: '1 decision waiting on you' }));
    expect(document.activeElement).toBe(decisionsCard());
    fireEvent.click(screen.getByRole('button', { name: '2 mentions' }));
    expect(navigate).toHaveBeenLastCalledWith('/mentions');
    fireEvent.click(screen.getByRole('button', { name: '1 conversation with something new' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Unread' }).parentElement);
  });

  it('opens the Agents page from the agents tile', () => {
    vi.mocked(navigate).mockClear();
    render(<HomeView />);
    fireEvent.click(screen.getByRole('button', { name: /Agents running/ }));
    expect(navigate).toHaveBeenLastCalledWith('/agents');
  });

  it('shows who is here as faces, not only a number', () => {
    useStore.setState({
      users: {
        u1: { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false },
        u2: { id: 'u2', kind: 'human', displayName: 'Ana', deactivated: false },
      },
      presence: { u2: 'active' },
    } as never);
    render(<HomeView />);
    const tile = screen.getByText('Here now').closest('.home-stat') as HTMLElement;
    expect(tile.querySelectorAll('.home-faces .avatar')).toHaveLength(1);
  });
});
