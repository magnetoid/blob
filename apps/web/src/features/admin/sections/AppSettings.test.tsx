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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../test/overlayChunk.ts';
import { AppSettings } from './AppSettings.tsx';
import { api } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

// An agent's page also lists the channels it follows (`AgentFollows`) and the MCP servers
// it may use (`AgentMcpServers`); none of either, here.
beforeEach(() => {
  vi.spyOn(api.admin, 'agentFollows').mockResolvedValue({ channels: [] });
  vi.spyOn(api.admin, 'mcpServers').mockResolvedValue({ servers: [] });
  // And what it remembers and the notes it kept, which every page of an app asks for.
  vi.spyOn(api.admin, 'agentMemory').mockResolvedValue({ memories: [] });
  vi.spyOn(api.admin, 'agentNotes').mockResolvedValue({ notes: [] });
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
  recentErrors: [],
  secretRotatedAt: null,
  tokenLastUsedAt: null,
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
  // The page hosts the per-app card now, which asks for these on arrival.
  vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
  vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
  vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
  vi.spyOn(api.admin, 'agentMemory').mockResolvedValue({ memories: [] } as never);
}

function ownerPicker() {
  return screen.getByRole('combobox', { name: 'Owner' }) as HTMLSelectElement;
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

describe('showing an agent its reasoning', () => {
  function seedAgent(showsReasoning: boolean) {
    useStore.setState({ users: { u1: ME, u2: MATE, u3: BOT } } as never);
    vi.spyOn(api.admin, 'plugins').mockResolvedValue({
      plugins: [
        {
          ...PLUGIN,
          aguiUrl: 'https://apps.example.com/agui',
          aguiVersion: '1.0',
          showsReasoning,
          tokensLastDay: 0,
        },
      ],
    } as never);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
    vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
    vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
    vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
  }

  it('is off until an admin turns it on, and the switch says which', async () => {
    seedAgent(false);
    const set = vi.spyOn(api.admin, 'setPluginReasoning').mockResolvedValue({} as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    const toggle = await screen.findByRole('switch', {
      name: 'Show its reasoning',
      checked: false,
      description: /Off by default/,
    });
    fireEvent.click(toggle);
    await waitFor(() => expect(set).toHaveBeenCalledWith('p1', true));
  });

  it('is not offered for an app that answers no mention', async () => {
    seed(null);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);
    await waitFor(() => expect(ownerPicker()).toBeTruthy());
    expect(screen.queryByRole('switch', { name: /reasoning/ })).toBeNull();
  });
});

describe("what an agent may do with Blob's tools", () => {
  it('offers the three levels and sends the one chosen', async () => {
    useStore.setState({ users: { u1: ME, u2: MATE, u3: BOT } } as never);
    vi.spyOn(api.admin, 'plugins').mockResolvedValue({
      plugins: [
        {
          ...PLUGIN,
          aguiUrl: 'https://apps.example.com/agui',
          aguiVersion: null,
          showsReasoning: false,
          tokensLastDay: 0,
          toolAccess: 'none',
        },
      ],
    } as never);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
    vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
    vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
    vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
    const set = vi.spyOn(api.admin, 'setPluginTools').mockResolvedValue({} as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    const select = (await screen.findByRole('combobox', {
      name: 'What it may do in the workspace',
    })) as HTMLSelectElement;
    expect(select.value).toBe('none');
    expect([...select.options].map((o) => o.value)).toEqual(['none', 'read', 'write']);
    fireEvent.change(select, { target: { value: 'write' } });
    await waitFor(() => expect(set).toHaveBeenCalledWith('p1', 'write'));
    // Asking first is the rule until the agent can post at all.
    expect(screen.queryByRole('combobox', { name: 'When it posts' })).toBeNull();
  });

  it('asks when it may post without asking only once it may post, and sends the choice', async () => {
    useStore.setState({ users: { u1: ME, u2: MATE, u3: BOT } } as never);
    vi.spyOn(api.admin, 'plugins').mockResolvedValue({
      plugins: [
        {
          ...PLUGIN,
          aguiUrl: 'https://apps.example.com/agui',
          aguiVersion: null,
          showsReasoning: false,
          tokensLastDay: 0,
          toolAccess: 'write',
          writeApproval: 'ask',
        },
      ],
    } as never);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
    vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
    vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
    vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
    const set = vi.spyOn(api.admin, 'setPluginTools').mockResolvedValue({} as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    const when = (await screen.findByRole('combobox', { name: 'When it posts' })) as HTMLSelectElement;
    expect(when.value).toBe('ask');
    expect([...when.options].map((o) => o.value)).toEqual([
      'ask',
      'auto_in_dm',
      'auto_everywhere',
    ]);
    fireEvent.change(when, { target: { value: 'auto_in_dm' } });
    await waitFor(() => expect(set).toHaveBeenCalledWith('p1', 'write', 'auto_in_dm'));
  });
});

describe('what an agent remembers', () => {
  it('lists the conversations it remembers, forgets one, and asks before forgetting all', async () => {
    seed(null);
    vi.spyOn(api.admin, 'agentMemory').mockResolvedValue({
      memories: [
        {
          id: 'mem1',
          pluginId: 'p1',
          agentName: 'Assistant',
          channelId: 'c9',
          channelName: 'launch',
          channelKind: 'public',
          inThread: false,
          updatedAt: '2026-10-07T09:00:00.000Z',
          size: 120,
          preview: '{"open":["docs"]}',
        },
      ],
    } as never);
    const one = vi.spyOn(api.admin, 'forgetAgentMemory').mockResolvedValue({ ok: true });
    const all = vi.spyOn(api.admin, 'forgetAllAgentMemory').mockResolvedValue({ ok: true });
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    expect(await screen.findByText('#launch')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    await waitFor(() => expect(one).toHaveBeenCalledWith('p1', 'mem1'));

    fireEvent.click(
      screen.getByRole('button', { name: 'Forget everything it remembers of conversations' }),
    );
    expect(all).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Forget every conversation' }));
    await waitFor(() => expect(all).toHaveBeenCalledWith('p1'));
  });
});

describe('the credentials an app holds', () => {
  it('says when its secret was rotated and whether its token is in use', async () => {
    useStore.setState({ users: { u1: ME, u2: MATE, u3: BOT } } as never);
    vi.spyOn(api.admin, 'plugins').mockResolvedValue({
      plugins: [
        {
          ...PLUGIN,
          secretRotatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          tokenLastUsedAt: null,
        },
      ],
    } as never);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
    vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
    vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
    vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
    vi.spyOn(api.admin, 'agentMemory').mockResolvedValue({ memories: [] } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    const line = await screen.findByText(/Signing secret rotated/);
    expect(line.textContent).toMatch(/Signing secret rotated 3h ago · no bot token used yet/);
  });
});

describe('the page itself', () => {
  it('is the app’s card: its name, what it is, where it points and what it may reach', async () => {
    seed(null);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Assistant' })).toBeTruthy();
    expect(screen.getByText(/assistant · v1\.0\.0 · enabled/)).toBeTruthy();
    expect(screen.getByText('https://apps.example.com/hook')).toBeTruthy();
    expect(screen.getByText('None granted.')).toBeTruthy();
  });

  it('goes back to the list', async () => {
    seed(null);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /All apps/ }));
    expect(window.location.pathname).toBe('/admin/apps');
  });

  it('says when the id names nothing installed here', async () => {
    vi.spyOn(api.admin, 'plugins').mockResolvedValue({ plugins: [] } as never);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
    vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
    vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
    vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);
    expect(await screen.findByText('That app is not installed here.')).toBeTruthy();
  });

  it('puts the last failure where it is read as an alert, and keeps the record under it', async () => {
    useStore.setState({ users: { u1: ME, u2: MATE, u3: BOT } } as never);
    vi.spyOn(api.admin, 'plugins').mockResolvedValue({
      plugins: [
        {
          ...PLUGIN,
          lastError: 'Circuit open: too many delivery failures.',
          recentErrors: [{ at: '2026-10-07T10:00:00.000Z', error: 'the agent answered 500' }],
        },
      ],
    } as never);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
    vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
    vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
    vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
    vi.spyOn(api.admin, 'agentMemory').mockResolvedValue({ memories: [] } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Last failure: Circuit open: too many delivery failures.');
    const record = screen.getByRole('button', { name: '1 recent error' });
    expect(record.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('where an agent can speak', () => {
  it('adds it to a channel, and takes it out of one', async () => {
    seed(null);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({
      channels: [
        { id: 'c1', name: 'general', kind: 'public', joined: true },
        { id: 'c2', name: 'launch', kind: 'public', joined: false },
      ],
    } as never);
    const join = vi.spyOn(api.admin, 'appJoinChannel').mockResolvedValue({ ok: true } as never);
    const leave = vi.spyOn(api.admin, 'appLeaveChannel').mockResolvedValue({ ok: true } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    const list = await screen.findByRole('list', { name: 'Channels' });
    const launch = within(within(list).getByText('#launch').closest('[role=listitem]') as HTMLElement);
    fireEvent.click(launch.getByRole('button', { name: 'Add #launch' }));
    await waitFor(() => expect(join).toHaveBeenCalledWith('p1', 'c2'));

    const general = within(within(list).getByText('#general').closest('[role=listitem]') as HTMLElement);
    fireEvent.click(general.getByRole('button', { name: 'Remove #general' }));
    await waitFor(() => expect(leave).toHaveBeenCalledWith('p1', 'c1'));
    expect(screen.getByText('Mentioning it in this channel will reach it.')).toBeTruthy();
  });
});

describe('the credentials an app is given', () => {
  function seedWithRotation() {
    seed(null);
    vi.spyOn(api.admin, 'rotatePluginSecret').mockResolvedValue({ signingSecret: 'whsec_rotated' } as never);
    vi.spyOn(api.admin, 'issuePluginToken').mockResolvedValue({ botToken: 'bot_issued' } as never);
  }

  it('shows a rotated secret once, in a field to copy from', async () => {
    seedWithRotation();
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);
    expect(screen.queryByRole('textbox', { name: 'Signing secret' })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Rotate secret' }));
    const field = (await screen.findByRole('textbox', { name: 'Signing secret' })) as HTMLInputElement;
    expect(field.value).toBe('whsec_rotated');
    expect(field.readOnly).toBe(true);
  });

  it('shows an issued token once, with the steps for a socket agent', async () => {
    useStore.setState({ users: { u1: ME, u2: MATE, u3: BOT } } as never);
    vi.spyOn(api.admin, 'plugins').mockResolvedValue({
      plugins: [{ ...PLUGIN, runtime: 'socket', requestUrl: null }],
    } as never);
    vi.spyOn(api.admin, 'appChannels').mockResolvedValue({ channels: [] } as never);
    vi.spyOn(api.admin, 'pluginCatalog').mockResolvedValue({ scopes: {}, events: {} } as never);
    vi.spyOn(api.admin, 'pluginRuns').mockResolvedValue({ runs: [] } as never);
    vi.spyOn(api.admin, 'pluginDeliveries').mockResolvedValue({ deliveries: [] } as never);
    vi.spyOn(api.admin, 'agentMemory').mockResolvedValue({ memories: [] } as never);
    vi.spyOn(api.admin, 'issuePluginToken').mockResolvedValue({ botToken: 'bot_issued' } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Issue token' }));
    const field = (await screen.findByRole('textbox', { name: 'Bot token' })) as HTMLInputElement;
    expect(field.value).toBe('bot_issued');
    expect(screen.getByRole('heading', { name: 'New credentials for Assistant' })).toBeTruthy();
    expect(screen.getByTestId('janus-setup')).toBeTruthy();
  });
});

describe('uninstalling', () => {
  it('asks first, and only then removes it and goes back to the list', async () => {
    seed(null);
    const uninstall = vi.spyOn(api.admin, 'uninstallPlugin').mockResolvedValue({ ok: true } as never);
    render(<AppSettings pluginId="p1" onError={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText('Uninstall Assistant?')).toBeTruthy();
    expect(uninstall).not.toHaveBeenCalled();

    fireEvent.click(dialog.getByRole('button', { name: 'Uninstall' }));
    await waitFor(() => expect(uninstall).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/apps'));
  });
});
