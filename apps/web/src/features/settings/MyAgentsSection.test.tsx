// @vitest-environment happy-dom
/**
 * What a person can see of their agents beyond their names (agentic phase 5): what agents
 * remember of their own conversations, cleared from here, and who their agent is lent
 * to, ended from here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  // What the page asks for beyond the test's own subject, so none of it reaches the network.
  vi.spyOn(api.agents, 'notes').mockResolvedValue({ notes: [] });
  vi.spyOn(api.agents, 'memory').mockResolvedValue({ memories: [] });
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
    const card = heading.closest<HTMLElement>('[data-slot="card"]')!;
    // The table carries the card's name, since it is the card's whole content.
    expect(within(card).getByRole('table', { name: 'What they spent' })).toBeTruthy();
    const row = card.querySelector('tbody tr')!;
    expect(row.textContent).toMatch(/Pip/);
    expect(row.textContent).toMatch(/9/);
    expect(row.textContent).toMatch(/€0\.15/);
    // Every row is the reader's own: no "Ana's" on each one.
    expect(row.textContent).not.toMatch(/Ana/);
    expect(api.agents.usage).toHaveBeenCalledWith(7);
  });
});

/** The rows of the "Your agents" card. */
async function agentRows() {
  const card = (await screen.findByRole('heading', { name: 'Your agents' })).closest<HTMLElement>(
    '[data-slot="card"]',
  )!;
  await within(card).findAllByRole('listitem');
  return within(card).getAllByRole('listitem');
}

describe('connecting an agent', () => {
  it('registers it under a name of three letters or more, and hands over its setup', async () => {
    const attach = vi.spyOn(api.agents, 'attach').mockResolvedValue({
      agent: { ...AGENT, name: 'Rex' },
      botToken: 'tok-1',
      signingSecret: 'sig-1',
    } as never);
    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);

    const name = await screen.findByRole('textbox', { name: 'Agent name' });
    const get = screen.getByRole<HTMLButtonElement>('button', { name: 'Get a token' });
    fireEvent.change(name, { target: { value: 'Re' } });
    expect(get.disabled).toBe(true);

    fireEvent.change(name, { target: { value: 'Rex' } });
    expect(get.disabled).toBe(false);
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(attach).toHaveBeenCalledWith('Rex'));

    // The setup is the old stylesheet's markup, so it sits in an island of its own.
    const command = await screen.findByText(/export BLOB_BOT_TOKEN=tok-1/);
    expect(command.closest('[data-legacy]')).not.toBeNull();
    expect((name as HTMLInputElement).value).toBe('');
  });
});

describe('your agents', () => {
  it('lists each with whether it is connected, and nothing else until one is added', async () => {
    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);
    const [row] = await agentRows();
    expect(within(row!).getByText('Pip')).toBeTruthy();
    expect(within(row!).getByText('connected')).toBeTruthy();
  });

  it('opens an agent’s channels under it, and adds it to one', async () => {
    vi.spyOn(api.agents, 'channels')
      .mockResolvedValueOnce({ channels: [{ id: 'c1', name: 'general', joined: false }] } as never)
      .mockResolvedValue({ channels: [{ id: 'c1', name: 'general', joined: true }] } as never);
    const join = vi.spyOn(api.agents, 'joinChannel').mockResolvedValue({ ok: true } as never);
    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);

    const toggle = await screen.findByRole('button', { name: 'Channels', expanded: false });
    fireEvent.click(toggle);
    expect(await screen.findByText('#general')).toBeTruthy();
    // The same words, the other state: the label does not change under a screen reader.
    expect(screen.getByRole('button', { name: 'Channels', expanded: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(join).toHaveBeenCalledWith('p1', 'c1'));
    // Asked for again, so the channel now offers the way back out instead of Add.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Add' })).toBeNull());
  });

  it('removes an agent only on the second press, and names it', async () => {
    const detach = vi.spyOn(api.agents, 'detach').mockResolvedValue({ ok: true } as never);
    render(<MyAgentsSection onError={vi.fn()} isOwner={false} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(detach).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Pip' }));
    await waitFor(() => expect(detach).toHaveBeenCalledWith('p1'));
  });
});
