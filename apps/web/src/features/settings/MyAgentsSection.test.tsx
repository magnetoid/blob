// @vitest-environment happy-dom
/**
 * What a person can see of their agents beyond their names (agentic phase 5): what agents
 * remember of their own conversations, cleared from here, and who their agent is lent
 * to, ended from here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, type AgentMemory, type MyAgent } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { MyAgentsSection } from './MyAgentsSection.tsx';

const AGENT = {
  id: 'p1',
  name: 'Pip',
  slug: 'pip',
  description: '',
  status: 'enabled',
  online: true,
  botUserId: 'b1',
  createdAt: '2026-10-01T09:00:00.000Z',
} as unknown as MyAgent;

const MEMORY: AgentMemory = {
  id: 'mem1',
  pluginId: 'p1',
  agentName: 'Pip',
  channelId: 'c1',
  channelName: 'general',
  channelKind: 'public',
  inThread: true,
  updatedAt: '2026-10-07T09:00:00.000Z',
  size: 2048,
  preview: '{"plan":["draft","ship"]}',
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useStore.setState({
    channels: { c1: { id: 'c1', kind: 'public', name: 'general', membership: {} } },
    channelTitle: (channel: { name: string | null }) => `#${channel.name}`,
  } as never);
  vi.spyOn(api.agents, 'mine').mockResolvedValue({ agents: [AGENT] });
  vi.spyOn(api.agents, 'usage').mockResolvedValue({
    days: 7,
    currency: 'EUR',
    agents: [],
    people: [],
    blob: [],
    models: [],
  });
});

afterEach(cleanup);

describe('what agents remember of you', () => {
  it('lists each memory with where it is from, and forgets one when asked', async () => {
    vi.spyOn(api.agents, 'memory')
      .mockResolvedValueOnce({ memories: [MEMORY] })
      .mockResolvedValue({ memories: [] });
    const forget = vi.spyOn(api.agents, 'forgetMemory').mockResolvedValue({ ok: true });

    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);

    expect(await screen.findByText('Pip · a thread in #general')).toBeTruthy();
    // The agent's own words, indented, behind a disclosure.
    expect(document.querySelector('.memory-preview pre')?.textContent).toBe(
      '{\n  "plan": [\n    "draft",\n    "ship"\n  ]\n}',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(forget).toHaveBeenCalledWith('mem1'));
    expect(await screen.findByText(/Nothing yet/)).toBeTruthy();
  });

  it('asks before forgetting everything', async () => {
    vi.spyOn(api.agents, 'memory').mockResolvedValue({ memories: [MEMORY] });
    const all = vi.spyOn(api.agents, 'forgetAllMemory').mockResolvedValue({ ok: true });
    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Forget everything' }));
    expect(all).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Forget all of it' }));
    await waitFor(() => expect(all).toHaveBeenCalled());
  });
});

describe('who your agent is lent to', () => {
  it('lists the loans and ends one', async () => {
    vi.spyOn(api.agents, 'memory').mockResolvedValue({ memories: [] });
    vi.spyOn(api.agents, 'loans')
      .mockResolvedValueOnce({
        loans: [
          {
            id: 'l1',
            granteeUserId: 'u2',
            granteeName: 'Bo',
            channelId: null,
            channelName: null,
            grantedAt: '2026-10-02T09:00:00.000Z',
          },
        ],
      })
      .mockResolvedValue({ loans: [] });
    const end = vi.spyOn(api.agents, 'endLoan').mockResolvedValue({ ok: true });
    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Lent to' }));
    expect(await screen.findByText('Bo · everywhere it is')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'End' }));
    await waitFor(() => expect(end).toHaveBeenCalledWith('p1', 'l1'));
    expect(await screen.findByText('Nobody else may use it.')).toBeTruthy();
  });
});

describe('what your agents spent', () => {
  it('shows this week’s runs, tokens and cost for your own agents', async () => {
    vi.spyOn(api.agents, 'memory').mockResolvedValue({ memories: [] });
    vi.spyOn(api.agents, 'notes').mockResolvedValue({ notes: [] });
    vi.spyOn(api.agents, 'usage').mockResolvedValue({
      days: 7,
      currency: 'EUR',
      agents: [
        {
          id: 'p1',
          name: 'Pip',
          ownerName: 'Ana',
          runs: 9,
          inputTokens: 40_000,
          outputTokens: 2_000,
          tokens: 42_000,
          cost: 0.15,
          costComplete: true,
        },
      ],
      people: [],
      blob: [],
      models: [],
    });
    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);
    const heading = await screen.findByRole('heading', { name: 'What they spent' });
    const row = heading.closest('section')!.querySelector('tbody tr')!;
    expect(row.textContent).toMatch(/Pip/);
    expect(row.textContent).toMatch(/9/);
    expect(row.textContent).toMatch(/€0\.15/);
    // Every row is the reader's own: no "Ana's" on each one.
    expect(row.textContent).not.toMatch(/Ana/);
    expect(api.agents.usage).toHaveBeenCalledWith(7);
  });
});
