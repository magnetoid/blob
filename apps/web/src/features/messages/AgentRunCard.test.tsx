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
import { cleanup, render, screen } from '@testing-library/react';
import type { AgentRunView } from '@blob/shared';
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
    expect(screen.getByText(/needs a decision/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /stop/i })).toBeNull();
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
