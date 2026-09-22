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
import { AgentRunCard } from './AgentRunCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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
    render(
      <AgentRunCard run={run({ status: 'interrupted', finishedAt: '2026-09-05T10:00:05.000Z' })} />,
    );
    expect(screen.getByText(/waiting for your answer/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
    // Never "see below": the same card renders on Home, where nothing is below it.
    expect(screen.queryByText(/see below/)).toBeNull();
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
