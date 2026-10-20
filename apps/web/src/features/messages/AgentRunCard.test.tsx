// @vitest-environment happy-dom
/**
 * The card under an agent's reply, once agents can ask each other things.
 *
 * What these pin is the lineage and the waiting states: a hop must say which agent asked
 * it (or it reads as an agent talking to itself), a run waiting on a decision must say so
 * rather than show a Stop button for something that is not running, and an answered or
 * expired one must read as such.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AgentRunCard as RunCard, AgentRunView } from '@blob/shared';
import { api, ApiError } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { useToasts } from '../../lib/toasts.ts';
import { AgentRunCard, SeenLine } from './AgentRunCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  useStore.setState({ currentUser: null, agentRuns: {} } as never);
});

/** Reading as the person the run is on behalf of. */
function asTheAsker(): void {
  useStore.setState({
    currentUser: { id: 'u-asker', kind: 'human', displayName: 'Ana', role: 'member', deactivated: false },
  } as never);
}

function run(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id: 'r1',
    pluginId: 'p1',
    agentName: 'Planner',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: 'm1',
    status: 'running',
    error: null,
    postCount: 0,
    startedAt: '2026-09-05T10:00:00.000Z',
    finishedAt: null,
    card: null,
    chainId: 'm0',
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: 'u-asker',
    answeredAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('lineage', () => {
  it('says which agent asked, on a hop', () => {
    render(<AgentRunCard run={run({ depth: 1, parentRunId: 'r0', askedBy: 'Janus' })} />);
    expect(screen.getByText(/asked by Janus/)).toBeTruthy();
    // The first hop needs no number; it is the obvious case.
    expect(screen.queryByText(/hop/)).toBeNull();
  });

  it('counts the hops past the first', () => {
    render(<AgentRunCard run={run({ depth: 2, parentRunId: 'r0', askedBy: 'Helper' })} />);
    expect(screen.getByText(/asked by Helper · hop 2/)).toBeTruthy();
  });

  it('says nothing about lineage when a person asked', () => {
    render(<AgentRunCard run={run()} />);
    expect(screen.queryByText(/asked by/)).toBeNull();
  });
});

describe('waiting on a decision', () => {
  it('says the run is waiting, and offers no Stop', () => {
    asTheAsker();
    render(
      <AgentRunCard run={run({ status: 'interrupted', finishedAt: '2026-09-05T10:00:05.000Z' })} />,
    );
    expect(screen.getByText(/waiting for your answer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
    // Never "see below": the same card renders on Home, where nothing is below it.
    expect(screen.queryByText(/see below/)).toBeNull();
  });

  it('says "your answer" only to the person who may give it', () => {
    // The card is the whole channel's. Everybody else reading "your answer" was being
    // told to decide something they cannot.
    useStore.setState({
      currentUser: { id: 'u-bo', kind: 'human', displayName: 'Bo', role: 'member', deactivated: false },
    } as never);
    render(
      <AgentRunCard run={run({ status: 'interrupted', finishedAt: '2026-09-05T10:00:05.000Z' })} />,
    );
    expect(screen.getByText(/waiting for an answer/)).toBeTruthy();
    expect(screen.queryByText(/your answer/)).toBeNull();
  });

  it('reads as answered once it has been', () => {
    render(
      <AgentRunCard
        run={run({
          status: 'interrupted',
          finishedAt: '2026-09-05T10:00:05.000Z',
          answeredAt: '2026-09-05T10:01:00.000Z',
        })}
      />,
    );
    expect(screen.getByText('answered')).toBeTruthy();
  });

  it('says when nobody answered in time', () => {
    render(
      <AgentRunCard run={run({ status: 'expired', finishedAt: '2026-09-06T10:00:05.000Z' })} />,
    );
    expect(screen.getByText(/nobody answered in time/)).toBeTruthy();
  });
});

describe('a chain', () => {
  it('shows the runs a person set going, in order, with this one marked', () => {
    // Janus answered Ana and its reply asked Planner and Writer: one chain, three runs.
    const root = run({ id: 'r1', agentName: 'Janus', status: 'succeeded', depth: 0 });
    const planner = run({ id: 'r2', agentName: 'Planner', depth: 1, askedBy: 'Janus' });
    const writer = run({
      id: 'r3',
      agentName: 'Writer',
      depth: 1,
      askedBy: 'Janus',
      status: 'failed',
      startedAt: '2026-09-05T10:00:01.000Z',
    });
    useStore.setState({ agentRuns: { r1: root, r2: planner, r3: writer } } as never);

    const { container } = render(<AgentRunCard run={planner} />);
    const chain = container.querySelector('.agent-run-chain');
    expect(chain?.textContent).toBe('Chain Janus → Planner, Writer');
    expect(chain?.querySelector('[aria-current="true"]')?.textContent).toBe('Planner');
    expect(chain?.querySelector('[data-status="failed"]')?.textContent).toBe('Writer');
  });

  it('says nothing for a run alone on its chain', () => {
    const alone = run();
    useStore.setState({ agentRuns: { r1: alone } } as never);
    const { container } = render(<AgentRunCard run={alone} />);
    expect(container.querySelector('.agent-run-chain')).toBeNull();
  });
});

describe('answering on the card', () => {
  const choosing = {
    prompt: 'Which release?',
    choices: [{ label: 'Release A' }, { label: 'Release B' }],
    freeText: false,
  };

  it('offers the asker the choices, and answers with the place of the one pressed', () => {
    asTheAsker();
    const answer = vi.spyOn(api.agentRuns, 'answer').mockResolvedValue({ ok: true });
    render(<AgentRunCard run={run({ status: 'interrupted', decision: choosing })} />);

    expect(screen.getByText('Which release?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Release B' }));
    // The place, not the label: the server hands the agent the value it declared.
    expect(answer).toHaveBeenCalledWith('r1', { choice: 1 }, expect.stringMatching(/^card-/));
  });

  it('offers nobody else anything to press', () => {
    useStore.setState({
      currentUser: { id: 'u-other', kind: 'human', displayName: 'Bo', role: 'member' },
    } as never);
    render(<AgentRunCard run={run({ status: 'interrupted', decision: choosing })} />);
    expect(screen.queryByRole('button', { name: 'Release A' })).toBeNull();
  });

  it('takes words when the question asked for words', () => {
    asTheAsker();
    const answer = vi.spyOn(api.agentRuns, 'answer').mockResolvedValue({ ok: true });
    render(
      <AgentRunCard
        run={run({
          status: 'interrupted',
          decision: { prompt: 'When should it ship?', choices: [], freeText: true },
        })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Answer Planner'), { target: { value: ' Tuesday ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
    expect(answer).toHaveBeenCalledWith('r1', { value: 'Tuesday' }, expect.any(String));
  });

  it('offers nothing once the question has been answered', () => {
    asTheAsker();
    render(
      <AgentRunCard
        run={run({
          status: 'interrupted',
          answeredAt: '2026-09-05T10:05:00.000Z',
          decision: choosing,
        })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Release A' })).toBeNull();
  });
});

describe('what a run was shown', () => {
  const seen = {
    messages: 12,
    window: 'thread' as const,
    files: 1,
    instructions: true,
    memory: false,
    task: true,
    tools: ['read_thread'],
    protocol: '1.0',
  };

  it('says it in one line, behind the details of a finished run', () => {
    render(<AgentRunCard run={finished({ seen })} compact />);
    fireEvent.click(screen.getByRole('button', { name: /Details of Janus/ }));
    expect(document.querySelector('.agent-run-seen')?.textContent).toBe(
      "Saw 12 messages of this thread · 1 file · the workspace's instructions · a task · tools: read_thread",
    );
  });

  it('says it on the card of a run that did not end well', () => {
    render(<AgentRunCard run={run({ status: 'failed', error: 'boom', seen })} />);
    expect(document.querySelector('.agent-run-seen')).toBeTruthy();
  });
});

describe('a question waiting on a person', () => {
  it('says how long is left to answer it', () => {
    vi.useFakeTimers({ now: new Date('2026-09-05T10:00:00.000Z') });
    asTheAsker();
    render(
      <AgentRunCard
        run={run({ status: 'interrupted', expiresAt: '2026-09-06T08:30:00.000Z' })}
      />,
    );
    expect(screen.getByText(/22h left to answer/)).toBeTruthy();
  });
});

describe('a run in progress', () => {
  /* The design calls this a "live plan": a run that is still going says so with a bar
     rather than a number, because there is no number to give — the model decides how
     many steps there are while it is taking them. */
  it('shows a running run as still going, and a finished one as finished', () => {
    const { container } = render(<AgentRunCard run={run({ status: 'running' })} />);
    expect(container.querySelector('.agent-run-progress')).toBeTruthy();

    cleanup();
    const done = render(<AgentRunCard run={run({ status: 'succeeded' })} />);
    expect(done.container.querySelector('.agent-run-progress')).toBeNull();
  });

  it('shows the answer being written as a draft, and never once the run is over', () => {
    const writing = { steps: [], tools: [], activity: null, reasoning: null, textChars: 11, dropped: 0 };
    const { container } = render(
      <AgentRunCard run={run({ card: { ...writing, textTail: 'hello world' } })} />,
    );
    const draft = container.querySelector('.agent-run-draft');
    expect(draft?.textContent).toBe('hello world');
    // Every few words of a sentence still being written is not news to announce.
    expect(draft?.getAttribute('aria-live')).toBe('off');

    cleanup();
    // A card that still holds a tail — a snapshot from just before the end — says
    // nothing once the run is over: the answer is posted, or never was the answer.
    const over = render(
      <AgentRunCard
        run={run({ status: 'failed', error: 'boom', card: { ...writing, textTail: 'half a' } })}
      />,
    );
    expect(over.container.querySelector('.agent-run-draft')).toBeNull();
  });
});

/** Seven seconds, finished, with an answer posted — the ordinary end of a run. */
function finished(overrides: Partial<AgentRunView> = {}): AgentRunView {
  return run({
    agentName: 'Janus',
    status: 'succeeded',
    postCount: 1,
    finishedAt: '2026-09-05T10:00:07.000Z',
    ...overrides,
  });
}

function work(overrides: Partial<RunCard> = {}): RunCard {
  return {
    steps: [],
    tools: [],
    activity: null,
    reasoning: null,
    textChars: 0,
    dropped: 0,
    ...overrides,
  };
}

/* In a conversation, a run that ended well is a quiet line under the message that asked,
   not a card: the answer below it is the thing to read, and a framed box after every
   answer was the loudest thing on the screen. Anything that still needs a person — a
   run going, one that failed or was refused, one waiting for an answer — keeps the card. */
describe('a finished run in a conversation', () => {
  it('is a line with the agent and how long it took, and no card', () => {
    const { container } = render(<AgentRunCard run={finished()} compact />);

    expect(container.querySelector('.agent-run-card')).toBeNull();
    const line = container.querySelector('.agent-run-line');
    expect(line?.textContent).toBe('Janus · 7s');
    // Text, not a control: nothing to press when there is nothing more to show.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says a stopped run was stopped', () => {
    const { container } = render(
      <AgentRunCard run={finished({ status: 'cancelled', postCount: 0 })} compact />,
    );
    expect(container.querySelector('.agent-run-card')).toBeNull();
    expect(container.querySelector('.agent-run-line')?.textContent).toBe('Janus · stopped');
  });

  it('keeps the lineage, as quietly', () => {
    const { container } = render(
      <AgentRunCard
        run={finished({ agentName: 'Helper', depth: 2, parentRunId: 'r0', askedBy: 'Janus' })}
        compact
      />,
    );
    expect(container.querySelector('.agent-run-line')?.textContent).toBe(
      'Helper · asked by Janus · hop 2 · 7s',
    );
  });

  it('says which MCP servers a run was offered tools from, not every tool on them', () => {
    render(
      <SeenLine
        seen={{
          messages: 3,
          window: 'channel',
          files: 0,
          instructions: false,
          memory: false,
          task: false,
          tools: ['read_channel'],
          servers: ['GitHub', 'Linear'],
          protocol: null,
        }}
      />,
    );
    expect(
      screen.getByText('Saw 3 messages of this channel · tools: read_channel · tools from GitHub, Linear'),
    ).toBeTruthy();
  });

  it('names the MCP server a tool call went to, beside the tool’s own name', () => {
    render(
      <AgentRunCard
        run={run({
          status: 'running',
          card: work({
            tools: [
              {
                name: 'github__create_issue',
                status: 'done',
                args: '{}',
                result: 'Opened #12',
                via: 'GitHub',
              },
              { name: 'read_channel', status: 'done', args: '{}', result: 'ok' },
            ],
          }),
        })}
      />,
    );
    expect(screen.getByText('create_issue')).toBeTruthy();
    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.queryByText('github__create_issue')).toBeNull();
    // Blob's own tools keep their names, with no server beside them.
    expect(screen.getByText('read_channel')).toBeTruthy();
  });

  it('keeps the steps behind one disclosure', () => {
    const { container } = render(
      <AgentRunCard
        run={finished({
          card: work({
            steps: [{ name: 'Read the channel', status: 'done' }],
            tools: [{ name: 'search', status: 'done', args: '{}', result: '3 hits' }],
          }),
        })}
        compact
      />,
    );

    const toggle = screen.getByRole('button', { name: "Details of Janus's run" });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // Not listed in the line: that is the whole difference from the card.
    expect(screen.queryByText('Read the channel')).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Read the channel')).toBeTruthy();
    expect(screen.getByText('search')).toBeTruthy();
    // Revealed where it is, not in a card of its own.
    expect(container.querySelector('.agent-run-card')).toBeNull();
  });

  it('offers the disclosure for reasoning alone', () => {
    render(<AgentRunCard run={finished({ card: work({ reasoning: 'Thought about it.' })})} compact />);
    expect(screen.getByRole('button', { name: "Details of Janus's run" })).toBeTruthy();
  });

  it('names its one button so it stands alone', () => {
    // Read out of context — a list of the page's buttons — "details" says nothing about
    // whose. The name says it once; describing the button by the line just before it
    // read the line twice to anybody reading in order.
    render(<AgentRunCard run={finished({ card: work({ reasoning: 'x' }) })} compact />);
    const toggle = screen.getByRole('button', { name: "Details of Janus's run" });
    expect(toggle.textContent).toBe('details');
    expect(toggle.hasAttribute('aria-describedby')).toBe(false);
  });

  it('is not announced when it replaces the card', () => {
    // The list is a live log that announces additions. A running card's status used to
    // settle in place and say nothing; the line arriving in its stead must not say more.
    const { container } = render(<AgentRunCard run={finished()} compact />);
    expect(container.querySelector('.agent-run-line')?.getAttribute('aria-live')).toBe('off');
  });

  it('offers none for a card with nothing in it', () => {
    render(<AgentRunCard run={finished({ card: work({ activity: 'Done' }) })} compact />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('follows the row it sits under out of the tab order', () => {
    // The list is a roving tabindex: one row is the tab stop and its controls follow
    // it. A native stop on every finished run would put one Tab press back per answer.
    render(<AgentRunCard run={finished({ card: work({ reasoning: 'x' }) })} compact isTabStop={false} />);
    expect(
      screen.getByRole('button', { name: "Details of Janus's run" }).getAttribute('tabindex'),
    ).toBe('-1');
  });

  it.each(['running', 'failed', 'refused', 'interrupted', 'expired'] as const)(
    'is still a card while it is %s',
    (status) => {
      const { container } = render(
        <AgentRunCard run={finished({ status, error: status === 'failed' ? 'boom' : null })} compact />,
      );
      expect(container.querySelector('.agent-run-card')).toBeTruthy();
      expect(container.querySelector('.agent-run-line')).toBeNull();
    },
  );

  it('is still a card outside a conversation', () => {
    // Home and the work panel list runs as their content; there the card is the point.
    const { container } = render(<AgentRunCard run={finished()} />);
    expect(container.querySelector('.agent-run-card')).toBeTruthy();
    expect(container.querySelector('.agent-run-line')).toBeNull();
  });
});

describe('Stop', () => {
  it('settles the card when the run had already ended, instead of an error', async () => {
    // The card had not heard the run finish — a frame missed in a reconnect — and the
    // server answers 404 to a Stop for a run that is not running.
    const reloadRuns = vi.fn(async () => undefined);
    useStore.setState({ reloadRuns } as never);
    vi.spyOn(api.agentRuns, 'cancel').mockRejectedValue(
      new ApiError(404, 'not_found', 'That run is not running.'),
    );
    render(<AgentRunCard run={run()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    await vi.waitFor(() => expect(reloadRuns).toHaveBeenCalledTimes(1));
    expect(useToastMessages()).toEqual([]);
  });
});

function useToastMessages(): string[] {
  return useToasts.getState().toasts.map((toast) => toast.text);
}

describe('AG-UI 1.0 on the card', () => {
  it('draws delegated work like the plan, and says which part failed', () => {
    render(
      <AgentRunCard
        run={run({
          card: {
            steps: [],
            tools: [],
            activity: null,
            subagents: [
              { name: 'researcher', status: 'done' },
              { name: 'writer', status: 'failed' },
            ],
            reasoning: null,
            textChars: 0,
            dropped: 0,
          },
        })}
      />,
    );
    const delegated = screen.getByRole('list', { name: 'Delegated to' });
    expect(delegated.textContent).toContain('researcher');
    expect(delegated.textContent).toContain('writer — failed');
  });

  it('says what a finished run reported it cost', () => {
    render(
      <AgentRunCard
        compact
        run={run({
          status: 'succeeded',
          postCount: 1,
          finishedAt: '2026-09-05T10:00:04.000Z',
          tokens: 12_400,
        })}
      />,
    );
    expect(screen.getByText(/4s · 12k tokens/)).toBeTruthy();
  });
});

describe('waiting on another agent (M2 · A2)', () => {
  it('says on whom it waits, and offers Stop', async () => {
    const cancel = vi.spyOn(api.agentRuns, 'cancel').mockResolvedValue({ ok: true });
    render(
      <AgentRunCard
        run={run({ status: 'waiting', askedAgent: 'Researcher', finishedAt: '2026-09-05T10:00:05.000Z' })}
      />,
    );
    expect(screen.getByText('waiting for Researcher')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cancel).toHaveBeenCalledWith('r1');
  });

  it('names nobody it cannot name', () => {
    render(<AgentRunCard run={run({ status: 'waiting', askedAgent: null })} />);
    expect(screen.getByText('waiting for another agent')).toBeTruthy();
  });
});

describe('a run that heard back', () => {
  it('says whom it asked, not that it answered silently', () => {
    render(
      <AgentRunCard
        run={run({
          status: 'succeeded',
          askedAgent: 'Researcher',
          postCount: 0,
          answeredAt: '2026-09-05T10:00:09.000Z',
          finishedAt: '2026-09-05T10:00:01.000Z',
        })}
      />,
    );
    expect(screen.getByText(/asked Researcher/)).toBeTruthy();
    expect(screen.queryByText(/answered silently/)).toBeNull();
  });
});
