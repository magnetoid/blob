// @vitest-environment happy-dom
/**
 * The Owner control.
 *
 * The rule it renders is the one the run job enforces: an unowned agent answers
 * everybody, an owned one answers its owner. A picker that shows the wrong answer is
 * worse than no picker at all — an admin would read "the workspace" off a personal
 * agent and never think to look again — so what these pin is that the control tells the
 * truth about who owns it, including when the owner is somebody the client cannot name.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppSettings } from './AppSettings.tsx';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ME = { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false };
const MATE = { id: 'u2', kind: 'human', displayName: 'Ana', deactivated: false };
const BOT = { id: 'u3', kind: 'bot', displayName: 'Assistant', deactivated: false };

const PLUGIN = {
  id: 'p1',
  slug: 'assistant',
  name: 'Assistant',
  description: null,
  runtime: 'external',
  status: 'enabled',
  version: '1.0.0',
  requestUrl: 'https://apps.example.com/hook',
  aguiUrl: null,
  events: [],
  scopes: [],
  pendingScopes: [],
  botUserId: 'u3',
  ownerUserId: null as string | null,
  lastError: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  pendingDeliveries: 0,
  failedDeliveries: 0,
  budgetRunsPerDay: null,
  budgetSecondsPerDay: null,
  runsLastDay: 0,
  secondsLastDay: 0,
};

function seed(ownerUserId: string | null) {
  useStore.setState({ users: { u1: ME, u2: MATE, u3: BOT } } as never);
  vi.spyOn(api.admin, 'plugins').mockResolvedValue({
    plugins: [{ ...PLUGIN, ownerUserId }],
  } as never);
  vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
}

function ownerPicker() {
  return screen.getByLabelText('Owner of Assistant') as HTMLSelectElement;
}

describe('who owns an agent', () => {
  it('offers the people in the workspace, and not the bots', async () => {
    // A bot owner is refused by the server, so offering one is a control whose only
    // outcome is an error message.
    seed(null);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    await waitFor(() => expect(ownerPicker()).toBeTruthy());
    const names = [...ownerPicker().options].map((o) => o.textContent);
    expect(names).toContain('Marko');
    expect(names).toContain('Ana');
    expect(names).not.toContain('Assistant');
  });

  it('says an unowned agent answers everybody', async () => {
    seed(null);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    await waitFor(() => expect(ownerPicker().value).toBe(''));
    expect(screen.getByText(/anyone can mention it/)).toBeTruthy();
  });

  it('names the owner, and does not read as unowned', async () => {
    seed('u2');
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    await waitFor(() => expect(ownerPicker().value).toBe('u2'));
    expect(screen.getByText(/Only Ana can command this agent/)).toBeTruthy();
  });

  it('still shows an owner the client cannot name', async () => {
    // Otherwise the select finds no matching option, falls back to its first, and the
    // screen quietly claims the workspace owns a personal agent.
    seed('u9');
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    await waitFor(() => expect(ownerPicker().value).toBe('u9'));
    expect(screen.getByText('Someone no longer here')).toBeTruthy();
  });

  it('hands an agent back to the workspace by choosing nobody', async () => {
    seed('u2');
    const set = vi
      .spyOn(api.admin, 'setPluginOwner')
      .mockResolvedValue({ ok: true } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    await waitFor(() => expect(ownerPicker().value).toBe('u2'));
    fireEvent.change(ownerPicker(), { target: { value: '' } });

    await waitFor(() => expect(set).toHaveBeenCalledWith('p1', null));
  });

  it('gives it to the person chosen', async () => {
    seed(null);
    const set = vi
      .spyOn(api.admin, 'setPluginOwner')
      .mockResolvedValue({ ok: true } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    await waitFor(() => expect(ownerPicker()).toBeTruthy());
    fireEvent.change(ownerPicker(), { target: { value: 'u1' } });

    await waitFor(() => expect(set).toHaveBeenCalledWith('p1', 'u1'));
  });
});
