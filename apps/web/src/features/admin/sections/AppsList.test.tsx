// @vitest-environment happy-dom
/** The agents console, as Meadow 2c draws it.
 *
 * It was three install forms above a column of cards. What these pin: the numbers add
 * up, each agent is one row of a table that says where it may act, the way in is one
 * button whose first choice is Janus, and the credentials a new agent is given are shown
 * in fields that can be copied from. Per-app controls are not here: they live on the app's
 * own page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '../../../test/overlayChunk.ts';

const plugins = vi.fn();
const activity = vi.fn();
const workspacePolicy = vi.fn();
const navigate = vi.fn();
const installPlugin = vi.fn();
const setPluginEnabled = vi.fn();
const updateSettings = vi.fn();
const settings = vi.fn();

vi.mock('../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      admin: {
        ...actual.api.admin,
        pluginCatalog: vi.fn(async () => ({ scopes: { 'messages:write': 'Post' }, events: {} })),
        plugins,
        settings,
        activity,
        workspacePolicy,
        installPlugin,
        setPluginEnabled,
        updateSettings,
      },
    },
  };
});

vi.mock('../../../lib/router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/router.ts')>();
  return { ...actual, navigate };
});

const { AppsSection } = await import('./AppsSection.tsx');
const { useStore } = await import('../../../lib/store.ts');

const plugin = (over: Record<string, unknown>) => ({
  id: 'p1',
  slug: 'scout',
  name: 'Scout',
  description: 'Research & analytics',
  runtime: 'socket',
  status: 'enabled',
  version: '1.0.0',
  requestUrl: null,
  aguiUrl: null,
  events: [],
  scopes: ['messages:read'],
  pendingScopes: [],
  botUserId: 'b1',
  ownerUserId: null,
  lastError: null,
  recentErrors: [],
  secretRotatedAt: null,
  tokenLastUsedAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  pendingDeliveries: 0,
  failedDeliveries: 0,
  online: true,
  budgetRunsPerDay: null,
  budgetSecondsPerDay: null,
  runsLastDay: 2,
  secondsLastDay: 30,
  runsLastWeek: 11,
  runningNow: 1,
  channelCount: 6,
  ...over,
});

beforeEach(() => {
  plugins.mockReset();
  activity.mockReset();
  workspacePolicy.mockReset();
  navigate.mockReset();
  installPlugin.mockReset();
  setPluginEnabled.mockReset();
  updateSettings.mockReset();
  settings.mockReset();
  settings.mockResolvedValue({ settings: { agentsEnabled: true } });
  plugins.mockResolvedValue({
    plugins: [
      plugin({}),
      plugin({
        id: 'p2',
        slug: 'janus',
        name: 'Janus',
        description: 'Janus, running beside Blob',
        runtime: 'external',
        scopes: ['messages:read', 'messages:write'],
        online: null,
        runsLastWeek: 30,
        runningNow: 0,
        channelCount: 4,
      }),
    ],
  });
  activity.mockResolvedValue({
    days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-09-0${i + 1}`, runs: i })),
  });
  workspacePolicy.mockResolvedValue({ agentChainMaxDepth: 3 });
  useStore.setState({ workspaceId: 'w1', users: {} } as never);
});
afterEach(cleanup);

const agentsTable = () => screen.findByRole('table', { name: 'Agents' });

describe('the agents console', () => {
  it('adds the numbers up in one line', async () => {
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/2 installed · 1 running now · 41 runs this week/)).toBeTruthy(),
    );
  });

  it('is one row per agent, saying where it may act', async () => {
    render(<AppsSection onError={vi.fn()} />);
    const table = await agentsTable();
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Agent',
      'Access',
      'Runs 7d',
      'Status',
      'Configure',
    ]);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);

    const scout = within(rows[0]!);
    expect(scout.getByText('Scout')).toBeTruthy();
    expect(scout.getByText('Research & analytics')).toBeTruthy();
    expect(scout.getByText('socket')).toBeTruthy();
    expect(scout.getByText('6 channels · read-only')).toBeTruthy();
    expect(scout.getByText('11')).toBeTruthy();
    expect(scout.getByRole('img', { name: '1 running now' })).toBeTruthy();
    expect(scout.getByText('enabled')).toBeTruthy();
    expect(scout.getByText('online')).toBeTruthy();

    expect(within(rows[1]!).getByText('4 channels')).toBeTruthy();
    // A running agent is the only one that says so.
    expect(within(rows[1]!).queryByRole('img')).toBeNull();
  });

  it('says a switched-off agent is, and offers to turn it on', async () => {
    plugins.mockResolvedValue({
      plugins: [plugin({ id: 'p4', name: 'Sleeper', status: 'disabled', runtime: 'external', online: null })],
    });
    setPluginEnabled.mockResolvedValue({});
    render(<AppsSection onError={vi.fn()} />);
    const row = within(await screen.findByRole('row', { name: /Sleeper/ }));
    expect(row.getByText('disabled')).toBeTruthy();
    // Only an agent that dials in has a connection to report.
    expect(row.queryByText('online')).toBeNull();
    expect(row.queryByText('offline')).toBeNull();

    fireEvent.click(row.getByRole('button', { name: 'Enable Sleeper' }));
    await waitFor(() => expect(setPluginEnabled).toHaveBeenCalledWith('p4', true));
  });

  it('turns an enabled agent off from its row', async () => {
    setPluginEnabled.mockResolvedValue({});
    render(<AppsSection onError={vi.fn()} />);
    const row = within(await screen.findByRole('row', { name: /Scout/ }));
    fireEvent.click(row.getByRole('button', { name: 'Disable Scout' }));
    await waitFor(() => expect(setPluginEnabled).toHaveBeenCalledWith('p1', false));
  });

  it('says it is loading, then that there are no agents yet', async () => {
    plugins.mockResolvedValue({ plugins: [] });
    render(<AppsSection onError={vi.fn()} />);
    expect(screen.getByText('Loading agents…')).toBeTruthy();
    expect(await screen.findByText('No agents yet')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Agents' })).toBeNull();
  });

  it('says so when the apps could not be read', async () => {
    plugins.mockRejectedValue(new Error('down'));
    const onError = vi.fn();
    render(<AppsSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load apps.'));
  });

  it('has the switch that lets agents run, on while they may, and sends the change', async () => {
    updateSettings.mockResolvedValue({ settings: { agentsEnabled: false } });
    render(<AppsSection onError={vi.fn()} />);
    const toggle = await screen.findByRole('switch', {
      name: 'Agents may run',
      description: /mentions of agents are refused/,
    });
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
    // What the server will say when the page asks again after the change.
    settings.mockResolvedValue({ settings: { agentsEnabled: false } });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ settings: { agentsEnabled: false } }),
    );
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
  });

  it('shows the guardrails honestly — two live, one not yet', async () => {
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/max 3 hops/)).toBeTruthy());
    expect(screen.getByText(/not yet available/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Guardrails' })).toBeTruthy();
  });

  it('says agents may not message each other when the depth is nothing', async () => {
    workspacePolicy.mockResolvedValue({ agentChainMaxDepth: 0 });
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/Agents may message each other — off/)).toBeTruthy());
  });

  it('sends the guardrails on to the page where they are set', async () => {
    render(<AppsSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'App policy' }));
    expect(navigate).toHaveBeenCalledWith('/server/app-policy');
  });

  it('still stands when the policy is not the admin’s to read', async () => {
    workspacePolicy.mockRejectedValue(new Error('403'));
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Scout')).toBeTruthy());
    expect(screen.getByText(/asker's permissions/)).toBeTruthy();
    expect(screen.queryByText(/hops/)).toBeNull();
  });

  it('has one way in, and Janus is the first choice', async () => {
    render(<AppsSection onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Scout')).toBeTruthy());
    expect(screen.queryByText(/Deploy an agent from a repository/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Install agent' }));
    const dialog = screen.getByRole('dialog', { name: 'Install an agent' });
    const choices = within(dialog).getByRole('group', { name: 'How the agent joins' });
    expect(within(choices).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Janus',
      'Another agent on this machine',
      'An app by URL',
    ]);
    expect(within(choices).getByRole('button', { name: 'Janus', pressed: true })).toBeTruthy();
    expect(dialog.textContent).toContain('no bridge');
  });

  it('chooses how the agent joins, one at a time, and says what each is', async () => {
    render(<AppsSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Install agent' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Install an agent' }));

    fireEvent.click(dialog.getByRole('button', { name: 'Another agent on this machine' }));
    expect(dialog.getByRole('button', { name: 'Another agent on this machine', pressed: true })).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Janus', pressed: false })).toBeTruthy();
    expect(dialog.getByText(/with the bridge holding Blob's socket/)).toBeTruthy();

    fireEvent.click(dialog.getByRole('button', { name: 'An app by URL' }));
    // An app by URL is registered by hand: slug, name, where it listens.
    expect(dialog.getByRole('textbox', { name: 'Slug' })).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Install app' })).toBeTruthy();

    // Pressing the one that is chosen would leave no way in chosen at all.
    fireEvent.click(dialog.getByRole('button', { name: 'An app by URL' }));
    expect(dialog.getByRole('button', { name: 'An app by URL', pressed: true })).toBeTruthy();
  });

  it('gives a new agent’s credentials once, in fields to copy from, ahead of the table', async () => {
    installPlugin.mockResolvedValue({
      plugin: plugin({ id: 'p9', name: 'Desktop Claude', slug: 'desktop-claude' }),
      botToken: 'bot_tok_123',
      signingSecret: 'whsec_456',
    });
    render(<AppsSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Install agent' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Install an agent' }));
    expect(screen.queryByRole('textbox', { name: 'Bot token' })).toBeNull();

    fireEvent.click(dialog.getByRole('button', { name: 'Connect an agent on your machine' }));
    fireEvent.change(dialog.getByRole('textbox', { name: 'What is it called?' }), {
      target: { value: 'Desktop Claude' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Get a token' }));

    const token = (await screen.findByRole('textbox', { name: 'Bot token' })) as HTMLInputElement;
    expect(token.value).toBe('bot_tok_123');
    expect(token.readOnly).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Signing secret' }) as HTMLInputElement).value).toBe('whsec_456');
    expect(screen.getByText(/these credentials are shown once/)).toBeTruthy();
    // And the steps that use them: Janus is the first way in.
    expect(screen.getByTestId('janus-setup')).toBeTruthy();
    // The dialog has done its work.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Install an agent' })).toBeNull());
  });

  it('sends Configure for the seeded Janus to its own page, and everything else to the app page', async () => {
    // Janus has a console page of its own — the workspace's half of it plus, for the
    // server's admin, what Janus runs on. The generic app page would show none of that.
    render(<AppsSection onError={vi.fn()} />);
    const table = await agentsTable();

    fireEvent.click(within(table).getByRole('button', { name: 'Configure Janus' }));
    expect(navigate).toHaveBeenCalledWith('/admin/janus');

    fireEvent.click(within(table).getByRole('button', { name: 'Configure Scout' }));
    expect(navigate).toHaveBeenCalledWith('/admin/apps/p1');
  });

  it('sends a Janus somebody owns to the app page, because the Janus page is not about it', async () => {
    // The slug is not the identity. A person's own agent called Janus, or one dialling in
    // over a socket, is configured where every other app is — and the Janus page's
    // workspace controls are ones the server would refuse for it.
    plugins.mockResolvedValue({
      plugins: [
        plugin({ id: 'p3', slug: 'janus', name: 'Janus', runtime: 'external', ownerUserId: 'u2' }),
      ],
    });
    render(<AppsSection onError={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Configure Janus' }));

    expect(navigate).toHaveBeenCalledWith('/admin/apps/p3');
  });

  it('draws a bar for every day of the week, and says them all to a reader', async () => {
    render(<AppsSection onError={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Runs this week' })).toBeTruthy();
    expect(screen.getAllByTitle(/^\d+ on 2026-09-0\d$/)).toHaveLength(7);
    // The bars are a picture; the same numbers are its name.
    const chart = screen.getByRole('img', { name: / 6$/ });
    expect(chart.getAttribute('aria-label')?.split(', ')).toHaveLength(7);
  });
});
