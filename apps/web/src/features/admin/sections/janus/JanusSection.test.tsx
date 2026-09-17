// @vitest-environment happy-dom
/** The Janus page — the half a workspace admin owns.
 *
 * What these pin is the half that has to keep working when the rest does not. The
 * workspace's own controls are the plugin row and the plugin routes, so they render for
 * an admin who is not the server's admin (`/api/admin/janus` answers 403 to them) and
 * while Janus itself is unreachable. The other pinned rule is the inert state: the two
 * controls the server accepts only for the agent it seeded are shown disabled with the
 * reason rather than hidden, because a control that has quietly gone missing reads as a
 * feature Blob does not have.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const plugins = vi.fn();
const janus = vi.fn();
const updateJanus = vi.fn();
const restartJanus = vi.fn();
const appChannels = vi.fn();
const pluginRuns = vi.fn();
const setPluginEverywhere = vi.fn();
const setPluginInstructions = vi.fn();
const setPluginEnabled = vi.fn();
const openDm = vi.fn();

vi.mock('../../../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      dms: { ...actual.api.dms, open: openDm },
      admin: {
        ...actual.api.admin,
        plugins,
        janus,
        updateJanus,
        restartJanus,
        appChannels,
        pluginRuns,
        setPluginEverywhere,
        setPluginInstructions,
        setPluginEnabled,
      },
    },
  };
});

const { JanusSection } = await import('./JanusSection.tsx');
const { ApiError } = await import('../../../../lib/api.ts');
const { useStore } = await import('../../../../lib/store.ts');

const sendMessage = vi.fn(async () => undefined);
const openChannel = vi.fn(async () => undefined);

const janusRow = (over: Record<string, unknown> = {}) => ({
  id: 'p-janus',
  slug: 'janus',
  name: 'Janus',
  description: 'Janus, running beside Blob.',
  runtime: 'external',
  status: 'enabled',
  version: '1.0.0',
  requestUrl: null,
  aguiUrl: 'http://janus:8642/v1/agui',
  events: [],
  scopes: ['messages:read', 'messages:write'],
  pendingScopes: [],
  botUserId: 'bot-janus',
  ownerUserId: null,
  lastError: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  pendingDeliveries: 0,
  failedDeliveries: 0,
  budgetRunsPerDay: null,
  budgetSecondsPerDay: null,
  runsLastDay: 0,
  secondsLastDay: 0,
  runsLastWeek: 4,
  runningNow: 0,
  channelCount: 2,
  inEveryPublicChannel: true,
  instructions: 'Answer in Serbian.',
  ...over,
});

const overview = (over: Record<string, unknown> = {}) => ({
  health: { data: { status: 'ok' }, error: null },
  capabilities: { data: null, error: null },
  config: { data: null, error: null },
  skills: { data: null, error: null },
  toolsets: { data: null, error: null },
  aguiUrl: 'http://janus:8642/v1/agui',
  secretSet: true,
  installs: [],
  ...over,
});

/** A key value, planted where nothing may ever print it. */
const PLANTED = 'sk-live-must-never-reach-the-page-9f3a';

/**
 * `GET /v1/config` as Blob relays it — Janus's own snake_case names, untouched, because
 * `config.data` is untyped all the way through and the page reads Janus's spelling.
 *
 * Two plants: `providers[0].key.value` and `providers[0].api_key` are fields no version
 * of Janus sends and the page does not model. They are here so a test can prove that the
 * page renders *what it read*, not whatever happened to be in the object — a future field
 * carrying a secret must not be able to reach the screen through a spread.
 */
const configData = (over: Record<string, unknown> = {}) => ({
  object: 'janus.config',
  version: '0.17.0',
  model: {
    default: 'deepseek-v4-pro',
    provider: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
  },
  agent: {
    max_turns: 60,
    reasoning_effort: 'medium',
    gateway_timeout: 1800,
    personality: 'helpful',
  },
  personalities: ['concise', 'helpful', 'technical'],
  toolsets: {
    // `retired-toolset` is enabled and no longer offered: a `PUT` that omitted it would
    // turn it off, so every test of the toolsets Save is a test of it surviving.
    available: ['janus-cli', 'web'],
    enabled: ['janus-cli', 'retired-toolset'],
    error: null,
  },
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      env: 'DEEPSEEK_API_KEY',
      key: { set: true, tail: 'a4f2', value: PLANTED },
      api_key: PLANTED,
    },
    { id: 'openai-api', name: 'OpenAI API', env: 'OPENAI_API_KEY', key: { set: false } },
    // Four characters or fewer: Janus sends no `tail`, because the last four characters
    // of a four-character secret are the secret.
    { id: 'local', name: 'Local', env: 'LOCAL_API_KEY', key: { set: true } },
  ],
  models: { provider: 'deepseek', ids: ['deepseek-flash', 'deepseek-v4-pro'], reason: null },
  raw: 'model:\n  default: deepseek-v4-pro\n',
  restart_pending: false,
  ...over,
});

/** The overview an instance admin gets when Janus is up and answering all five routes. */
const serverOverview = (
  config: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
) =>
  overview({
    config: { data: configData(config), error: null },
    capabilities: { data: { platform: 'janus-agent', model: 'janus-agent' }, error: null },
    skills: {
      data: {
        object: 'list',
        data: [{ name: 'brainstorming', description: 'Explore intent', category: 'work' }],
      },
      error: null,
    },
    toolsets: { data: { object: 'list', data: [] }, error: null },
    ...over,
  });

/** Janus's answer to a write. */
const applied = (over: Record<string, unknown> = {}) => ({
  applied: {},
  warnings: [],
  restarting: false,
  drainTimeoutSeconds: 180,
  ...over,
});

/** The env block renders one line per variable; a marked one carries its reason. */
function envLine(name: string): string {
  const code = screen.getByText(new RegExp(`^${name}=`));
  return code.closest('[data-env-line]')?.textContent ?? '';
}

beforeEach(() => {
  for (const fn of [
    plugins, janus, updateJanus, restartJanus, appChannels, pluginRuns,
    setPluginEverywhere, setPluginInstructions, setPluginEnabled, openDm,
    sendMessage, openChannel,
  ]) fn.mockReset();

  plugins.mockResolvedValue({ plugins: [janusRow()] });
  janus.mockResolvedValue(overview());
  updateJanus.mockResolvedValue(applied());
  restartJanus.mockResolvedValue(applied());
  appChannels.mockResolvedValue({
    channels: [
      { id: 'c1', name: 'general', kind: 'public', joined: true },
      { id: 'c2', name: 'design', kind: 'public', joined: false },
    ],
  });
  pluginRuns.mockResolvedValue({ runs: [] });
  setPluginEverywhere.mockResolvedValue(janusRow({ inEveryPublicChannel: false }));
  setPluginInstructions.mockResolvedValue(janusRow());
  setPluginEnabled.mockResolvedValue(janusRow());
  openDm.mockResolvedValue({ channel: { id: 'dm1', kind: 'dm', name: null } });
  sendMessage.mockResolvedValue(undefined);
  openChannel.mockResolvedValue(undefined);

  window.history.replaceState(null, '', '/admin/janus');
  useStore.setState({
    currentUser: { id: 'u1', displayName: 'Marko', role: 'owner' },
    users: {},
    channels: {},
    sendMessage,
    openChannel,
  } as never);
});

afterEach(() => {
  cleanup();
  // The restart watch is the only thing here that keeps a timer, and a test that left
  // fake time installed would hand the next one a clock that never moves.
  vi.useRealTimers();
});

describe('when this stack has no Janus', () => {
  it('prints the four lines it needs, and marks the one that is not set', async () => {
    plugins.mockResolvedValue({ plugins: [] });
    janus.mockResolvedValue(overview({ aguiUrl: '', secretSet: true }));

    render(<JanusSection onError={vi.fn()} isOwner />);

    await waitFor(() => expect(screen.getByText(/^JANUS_AGUI_URL=/)).toBeTruthy());
    expect(envLine('JANUS_AGUI_URL')).toContain('not set');
    expect(envLine('JANUS_SIGNING_SECRET')).not.toContain('not set');
    expect(envLine('JANUS_API_SERVER_KEY')).not.toContain('not set');
    expect(envLine('JANUS_VERSION')).toContain('0.17.0');
  });

  it('does not claim the stack is broken when it is only this workspace that has none', async () => {
    // The stack answers, and `Installs` right below says a workspace missing the agent is
    // seeded on the next start — so a headline saying Janus is not running here at all was
    // the page contradicting itself two paragraphs apart.
    plugins.mockResolvedValue({ plugins: [] });

    render(<JanusSection onError={vi.fn()} isOwner />);

    await waitFor(() => expect(screen.getByText(/^JANUS_AGUI_URL=/)).toBeTruthy());
    expect(screen.queryByText(/not running in this stack/)).toBeNull();
    expect(screen.getByText(/seeded on the next start of the app/)).toBeTruthy();
  });

  it('holds the headline until it knows which of the two is true', async () => {
    // The plugin list always lands first, so for the whole life of the overview request
    // the page knew there was no row and did not yet know whether the stack had Janus at
    // all. It picked the workspace-shaped headline and flipped a moment later.
    plugins.mockResolvedValue({ plugins: [] });
    let refuse!: (reason: unknown) => void;
    janus.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);
    // Synchronous from here: a `findBy*` waits the flash out and sees nothing wrong.
    expect(await screen.findByRole('button', { name: '← All apps' })).toBeTruthy();

    expect(screen.queryByText(/This workspace has no Janus yet/)).toBeNull();
    expect(screen.queryByText(/not running in this stack/)).toBeNull();

    await act(async () => {
      refuse(new ApiError(400, 'janus_not_configured', 'Janus is not running in this stack.'));
    });

    expect(await screen.findByText(/not running in this stack/)).toBeTruthy();
  });

  it('says the stack has none when the server says so', async () => {
    plugins.mockResolvedValue({ plugins: [] });
    janus.mockRejectedValue(
      new ApiError(400, 'janus_not_configured', 'Janus is not running in this stack.'),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(await screen.findByText(/not running in this stack/)).toBeTruthy();
  });

  it('names all three when the server cannot say which is missing', async () => {
    // `janus_not_configured` is the answer when any of the three is unset, and it does
    // not say which — so the page names all three rather than guessing at one.
    plugins.mockResolvedValue({ plugins: [] });
    janus.mockRejectedValue(
      new ApiError(400, 'janus_not_configured', 'Janus is not running in this stack.'),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    await waitFor(() => expect(screen.getByText(/^JANUS_AGUI_URL=/)).toBeTruthy());
    expect(envLine('JANUS_AGUI_URL')).toContain('not set');
    expect(envLine('JANUS_SIGNING_SECRET')).toContain('not set');
    expect(envLine('JANUS_API_SERVER_KEY')).toContain('not set');
  });
});

describe('this workspace', () => {
  it('renders from the plugin row alone, when the overview is not this admin’s to read', async () => {
    // A workspace admin who is not an instance admin gets 403 from /api/admin/janus.
    // Everything on this half is the plugin row and the plugin routes, so it stands.
    janus.mockRejectedValue(new ApiError(403, 'forbidden', 'Only a server administrator can do that.'));

    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(await screen.findByRole('button', { name: 'Say hello' })).toBeTruthy();
    expect(screen.queryByText(/^JANUS_AGUI_URL=/)).toBeNull();
    expect(await screen.findByText('#general')).toBeTruthy();
    expect(
      (screen.getByLabelText('Instructions for Janus') as HTMLTextAreaElement).value,
    ).toBe('Answer in Serbian.');
  });

  it('turns the everywhere switch off through the plugin route', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    const toggle = await screen.findByRole('button', {
      name: 'Join every public channel automatically',
    });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);

    await waitFor(() => expect(setPluginEverywhere).toHaveBeenCalledWith('p-janus', false));
  });

  it('saves the instructions trimmed, and counts against the 4000 the server takes', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    const box = await screen.findByLabelText('Instructions for Janus');
    fireEvent.change(box, { target: { value: '  Be brief. Answer in Serbian.\n' } });
    expect(screen.getByText(/\/ 4000/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));

    await waitFor(() =>
      expect(setPluginInstructions).toHaveBeenCalledWith('p-janus', 'Be brief. Answer in Serbian.'),
    );
  });

  it('says hello in a DM, through the ordinary send path', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.click(await screen.findByRole('button', { name: 'Say hello' }));

    await waitFor(() => expect(openDm).toHaveBeenCalledWith(['bot-janus']));
    await waitFor(() =>
      expect(sendMessage).toHaveBeenCalledWith('dm1', 'hello', null, [], false),
    );
    await waitFor(() => expect(window.location.pathname).toBe('/c/dm1'));
  });

  it('shows the two seeded-only controls inert, with the reason, for an agent somebody owns', async () => {
    // The run job stops forwarding stored instructions the moment the row stops being
    // the seeded identity, and the routes refuse the write. Hiding the controls would
    // read as "Blob cannot do this"; disabled with the reason is the truth.
    plugins.mockResolvedValue({ plugins: [janusRow({ ownerUserId: 'u2' })] });

    render(<JanusSection onError={vi.fn()} isOwner />);

    const toggle = await screen.findByRole('button', {
      name: 'Join every public channel automatically',
    });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Instructions for Janus') as HTMLTextAreaElement).disabled).toBe(true);
    // Both controls say it, each where it is: an admin who scrolled to one of them
    // should not have to find the other to learn why it is dead.
    expect(screen.getAllByText(/not the workspace's to instruct/)).toHaveLength(2);
    // Off as well as dead, and now true of the server: the auto-join asks for the seeded
    // identity as well as the flag, so a row that has been given away is seated nowhere
    // new however the flag was left. Drawing it on would be the only honest alternative.
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('clears the instructions with an explicit null when the box is emptied', async () => {
    // "" and null mean the same thing to the route, but the wire should say what the
    // screen says: this workspace now has nothing standing to tell its agent.
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.change(await screen.findByLabelText('Instructions for Janus'), {
      target: { value: '   \n ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save instructions' }));

    await waitFor(() => expect(setPluginInstructions).toHaveBeenCalledWith('p-janus', null));
  });

  it('associates each dead control with the sentence that explains it', async () => {
    // Adjacent is not associated: a screen reader on the disabled switch announced a
    // switch that is off and dead, and never the reason sitting beside it.
    render(<JanusSection onError={vi.fn()} isOwner />);

    const toggle = await screen.findByRole('button', {
      name: 'Join every public channel automatically',
    });
    const described = (el: Element) =>
      (el.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ');

    expect(described(toggle)).toMatch(/Public channels founded from now on/);
    // The textarea carries both its reason and the count, which is the other thing
    // somebody typing into it cannot see.
    const box = screen.getByLabelText('Instructions for Janus');
    expect(described(box)).toMatch(/Sent with every run/);
    expect(described(box)).toMatch(/\/ 4000/);
  });

  it('says nothing about empty channels or an empty log until it has asked', async () => {
    // "Janus is not in any channel yet, so nobody can reach it" is a diagnosis, and for
    // the first moment of every visit it was one the page had no evidence for.
    appChannels.mockReturnValue(new Promise(() => {}));
    pluginRuns.mockReturnValue(new Promise(() => {}));

    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(await screen.findByRole('button', { name: 'Say hello' })).toBeTruthy();
    expect(screen.queryByText(/is not in any channel yet/)).toBeNull();
    expect(screen.queryByText(/has not been asked anything yet/)).toBeNull();
    expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
  });

  it('does not re-read Janus itself when the workspace changes its own row', async () => {
    // The overview costs five upstream calls to Janus, one of which asks its provider for
    // a model list. A budget edit has nothing to do with any of that.
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Join every public channel automatically' }),
    );

    await waitFor(() => expect(plugins).toHaveBeenCalledTimes(2));
    expect(janus).toHaveBeenCalledTimes(1);
  });

  it('has a way back to the list, the way an app page has', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.click(await screen.findByRole('button', { name: '← All apps' }));

    expect(window.location.pathname).toBe('/admin/apps');
  });

  it('says so when the agents could not be listed at all', async () => {
    // The plugin list is the whole workspace half. Without it the section drew nothing
    // but the console's error line, which sits below a page that looked simply empty.
    plugins.mockRejectedValue(new ApiError(500, 'server_error', 'Nope.'));

    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(await screen.findByText(/could not be read/)).toBeTruthy();
  });
});

describe('every workspace on this server', () => {
  it('lists the installs the overview reports, marking this one', async () => {
    janus.mockResolvedValue(
      overview({
        installs: [
          {
            workspaceId: 'w1',
            workspaceName: 'Imba',
            pluginId: 'p-janus',
            status: 'enabled',
            channelCount: 2,
            runsLastWeek: 4,
            isThisWorkspace: true,
          },
          {
            workspaceId: 'w2',
            workspaceName: 'Hadley',
            pluginId: 'p-other',
            status: 'disabled',
            channelCount: 0,
            runsLastWeek: 0,
            isThisWorkspace: false,
          },
        ],
      }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    await waitFor(() => expect(screen.getByText('Hadley')).toBeTruthy());
    expect(screen.getByText('Imba').closest('tr')?.textContent).toContain('this one');
  });

  it('is never asked for by an admin who does not own the server', async () => {
    render(<JanusSection onError={vi.fn()} isOwner={false} />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Say hello' })).toBeTruthy());
    expect(janus).not.toHaveBeenCalled();
  });
});

/**
 * Let everything waiting on a promise or a timer finish, on whichever clock is installed.
 *
 * `useFetch` defers its request by a zero-length timeout, so under fake timers even the
 * first load needs the clock nudged before anything is on the screen.
 */
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('this server', () => {
  // Janus up and answering all five of its routes, which is the state every one of these
  // departs from. The shared `overview()` is the workspace half's, where Janus's own
  // answers are beside the point.
  //
  // A block body, not an expression: `mockResolvedValue` answers with the mock itself,
  // and a hook that returns a *function* has handed vitest a teardown to call — which it
  // does, against whatever mock the test body installed afterwards.
  beforeEach(() => {
    janus.mockResolvedValue(serverOverview());
  });

  it('does not say Janus could not be read while it is still being read', async () => {
    // The overview starts at null and the plugin list always resolves first, so "what
    // Janus runs on could not be read just now" — with a Retry that costs ten more
    // upstream calls — was on screen for every owner, on every visit, until the request
    // it was reporting on had even landed.
    let answer!: (value: unknown) => void;
    janus.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);
    // The workspace half does not wait on the overview and must not start to: this is the
    // proof that the plugin list has landed while the overview has not.
    expect(await screen.findByRole('button', { name: 'Say hello' })).toBeTruthy();

    expect(screen.queryByText(/could not be read just now/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();

    await act(async () => {
      answer(serverOverview());
    });

    expect(await screen.findByLabelText('Max turns')).toBeTruthy();
  });

  it('offers the models Janus listed, and what it runs on now', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    const model = (await screen.findByLabelText('Model')) as HTMLSelectElement;
    expect(model.tagName).toBe('SELECT');
    expect([...model.options].map((option) => option.value)).toEqual([
      'deepseek-flash',
      'deepseek-v4-pro',
    ]);
    expect(model.value).toBe('deepseek-v4-pro');
    // Read-only, and there to say what the agent can already do.
    expect(screen.getByText('brainstorming')).toBeTruthy();
  });

  it('takes a typed model name when the provider would not list them, and says why', async () => {
    // `deepseek-chat` was retired upstream and failed by *hanging*. The list exists so a
    // name Janus cannot serve is unpickable — and when the list is missing, the reason
    // has to be on the screen or the text field reads as the page being lazy.
    janus.mockResolvedValue(
      serverOverview({
        models: { provider: 'deepseek', ids: null, reason: 'deepseek: 401 Unauthorized' },
      }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    const model = (await screen.findByLabelText('Model')) as HTMLInputElement;
    expect(model.tagName).toBe('INPUT');
    expect(model.value).toBe('deepseek-v4-pro');
    expect(screen.getByText(/401 Unauthorized/)).toBeTruthy();
  });

  it('says whether a key is set, and never what it is', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(await screen.findByText(/set, ends a4f2/)).toBeTruthy();
    const field = screen.getByLabelText('API key') as HTMLInputElement;
    expect(field.value).toBe('');
    // Not "the tail is not the value": nothing anywhere on the page is the value, and the
    // planted fields are ones no Janus sends, so a spread is the only way they could.
    expect(document.body.textContent).not.toContain(PLANTED);
    expect(document.body.innerHTML).not.toContain(PLANTED);

    // The other two states, on the two providers that carry them. A key of four
    // characters or fewer arrives with no tail at all, and "set" is the whole truth.
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'local' } });
    expect(screen.getByText(/LOCAL_API_KEY/).textContent).toContain('set');
    expect(screen.queryByText(/ends/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai-api' } });
    expect(screen.getByText(/OPENAI_API_KEY/).textContent).toContain('not set');
  });

  it('saves the one field that changed, and nothing else', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    const save = (await screen.findByRole('button', { name: 'Save model' })) as HTMLButtonElement;
    // Janus answers 400 to `{"model": {}}`, and Blob answers `janus_empty_change` to a
    // body with nothing in it. An untouched form must not be able to send either.
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-flash' } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(updateJanus).toHaveBeenCalledWith({ model: { default: 'deepseek-flash' } }),
    );
  });

  it('sends a typed key once, under the selected provider’s variable, and forgets it', async () => {
    render(<JanusSection onError={vi.fn()} isOwner />);

    const field = (await screen.findByLabelText('API key')) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'sk-brand-new-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));

    await waitFor(() =>
      expect(updateJanus).toHaveBeenCalledWith({ apiKeys: { DEEPSEEK_API_KEY: 'sk-brand-new-key' } }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(''),
    );
  });

  it('forgets a typed key even when the save failed', async () => {
    // The dangerous path: a refusal leaves the admin on the form, and a key left sitting
    // in the box would ride along with whatever they change next — or sit in a rendered
    // input on a screen somebody walks away from.
    updateJanus.mockRejectedValue(new ApiError(400, 'janus_refused', 'that is not a key'));
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.change(await screen.findByLabelText('API key'), {
      target: { value: 'sk-brand-new-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));

    await waitFor(() =>
      expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe(''),
    );
    expect(document.body.innerHTML).not.toContain('sk-brand-new-key');
  });

  it('sends a number where Janus wants a number', async () => {
    // `max_turns: "80"` is a 400 from Janus. An input's value is a string, always.
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.change(await screen.findByLabelText('Max turns'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save behaviour' }));

    await waitFor(() => expect(updateJanus).toHaveBeenCalledWith({ agent: { max_turns: 80 } }));
  });

  it('waits out a restart, then shows what Janus came back on', async () => {
    vi.useFakeTimers();
    updateJanus.mockResolvedValue(applied({ restarting: true, drainTimeoutSeconds: 180 }));
    render(<JanusSection onError={vi.fn()} isOwner />);
    await settle();

    fireEvent.change(screen.getByLabelText('Max turns'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save behaviour' }));
    await settle();
    expect(screen.getByText(/Janus is restarting/)).toBeTruthy();

    // Still draining. The overview itself answers 200 — the five Janus routes are each
    // fetched into their own tile, so Janus being gone is `health.error` and not a
    // refusal — and the poll reads `health.data` rather than the request's success.
    janus.mockResolvedValue(
      overview({
        health: { data: null, error: 'ConnectError: All connection attempts failed' },
        config: { data: null, error: 'ConnectError: All connection attempts failed' },
      }),
    );
    await settle(3000);
    expect(screen.getByText(/Janus is restarting/)).toBeTruthy();

    janus.mockResolvedValue(
      serverOverview({
        agent: { max_turns: 80, reasoning_effort: 'medium', gateway_timeout: 1800, personality: 'helpful' },
      }),
    );
    // The poll that finds it, then the reload that poll asks for. No `waitFor` anywhere
    // in here: its own polling runs on the timers this test has frozen.
    await settle(3000);
    await settle();

    expect(screen.queryByText(/Janus is restarting/)).toBeNull();
    expect((screen.getByLabelText('Max turns') as HTMLInputElement).value).toBe('80');
  });

  it('gives up on a restart that outlasts the drain, and says so', async () => {
    vi.useFakeTimers();
    restartJanus.mockResolvedValue(applied({ restarting: true, drainTimeoutSeconds: 180 }));
    render(<JanusSection onError={vi.fn()} isOwner />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Restart Janus' }));
    await settle();
    expect(restartJanus).toHaveBeenCalledWith();
    expect(screen.getByText(/Janus is restarting/)).toBeTruthy();

    // A request that fails outright is also an answer the watch has to survive — the app
    // itself can be mid-deploy — so this is the path the poll's `catch` covers.
    janus.mockRejectedValue(new ApiError(400, 'janus_unreachable', 'Janus did not answer.'));
    await settle(220_000);

    expect(screen.getByText(/has not come back/)).toBeTruthy();
    expect(screen.queryByText(/Janus is restarting/)).toBeNull();
    // The readings on the screen are from before the restart, so the one thing that has
    // to be here is a button that asks again — and the banner has to name it, because
    // Restart itself is disabled from here and nothing else says what the way back is.
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText(/Retry below asks it again/)).toBeTruthy();

    // The other way a poll fails to answer: one that never settles at all. The cap used
    // to be read only after a request came back, so a Janus that accepts the connection
    // and then says nothing left the page `restarting` for ever — every form dead, no
    // banner and no Retry — until the browser's own network timeout, minutes away.
    janus.mockResolvedValue(serverOverview());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(screen.queryByText(/has not come back/)).toBeNull();

    janus.mockImplementation(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Restart Janus' }));
    await settle();
    expect(screen.getByText(/Janus is restarting/)).toBeTruthy();

    await settle(220_000);
    expect(screen.getByText(/has not come back/)).toBeTruthy();
    expect(screen.queryByText(/Janus is restarting/)).toBeNull();
  });

  it('sends the whole enabled list, including a toolset this Janus no longer offers', async () => {
    // Janus takes the list as the truth and drops what is left out, so a page that sent
    // only the boxes it drew would silently turn off a toolset it never showed.
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.click(await screen.findByLabelText('web'));
    fireEvent.click(screen.getByRole('button', { name: 'Save toolsets' }));

    await waitFor(() =>
      expect(updateJanus).toHaveBeenCalledWith({
        toolsets: ['janus-cli', 'retired-toolset', 'web'],
      }),
    );
  });

  it('sends the file on its own, and shows every issue Janus answered with', async () => {
    updateJanus.mockRejectedValue(
      new ApiError(400, 'janus_refused', 'model must be a mapping', undefined, {
        issues: [
          { severity: 'error', message: 'model must be a mapping', hint: 'model.default' },
          { severity: 'warning', message: 'and another thing', hint: '' },
        ],
      }),
    );
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.change(await screen.findByLabelText('config.yaml'), {
      target: { value: 'model: 3\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save config.yaml' }));

    // Alone: Janus refuses `raw` alongside any of model, agent or toolsets.
    await waitFor(() => expect(updateJanus).toHaveBeenCalledWith({ raw: 'model: 3\n' }));
    expect(await screen.findByText('model must be a mapping')).toBeTruthy();
    expect(screen.getByText('and another thing')).toBeTruthy();
    expect(screen.getByText('model.default')).toBeTruthy();
  });

  it('says what to do when the file still carries a redacted key', async () => {
    const onError = vi.fn();
    updateJanus.mockRejectedValue(
      new ApiError(
        400,
        'janus_raw_redacted',
        'The file still holds a redacted key. Put the key back, or move it to the environment.',
      ),
    );
    render(<JanusSection onError={onError} isOwner />);

    fireEvent.change(await screen.findByLabelText('config.yaml'), {
      target: { value: 'custom_providers:\n  house:\n    api_key: «redacted»\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save config.yaml' }));

    // Beside the box, not only in the console's one error line: the box is long enough
    // that the line at the top of the page can be off the screen when Save is clicked.
    expect(await screen.findByText(/still holds a redacted key/)).toBeTruthy();
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('still holds a redacted key')),
    );
  });

  it('tells a workspace admin who is not this server’s admin who can change it', async () => {
    janus.mockRejectedValue(
      new ApiError(403, 'forbidden', 'Only a server administrator can do that.'),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(
      await screen.findByText("Only the server's admin can change what Janus runs on."),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save model' })).toBeNull();
    expect(screen.queryByLabelText('config.yaml')).toBeNull();
  });

  it('tells an admin who does not own the server who can, in the same words as the 403', async () => {
    // The nav row is not `ownerOnly`, so a workspace admin who does not administer this
    // machine arrives here and finds half a page. Silence reads as a bug; one line saying
    // it is a permission does not. The same sentence as the `forbidden` branch above,
    // because it is the same fact — the request is skipped only to keep a 403 out of the
    // network log, and skipping it must not change what the page says.
    render(<JanusSection onError={vi.fn()} isOwner={false} />);

    expect(
      await screen.findByText("Only the server's admin can change what Janus runs on."),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Say hello' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save model' })).toBeNull();
    expect(screen.queryByLabelText('config.yaml')).toBeNull();
  });

  it('draws Janus as not answering, with the controls dead and a Retry', async () => {
    // Every part fails together when the container is down. The forms stay on the screen
    // rather than vanishing — a control that has quietly gone missing reads as a thing
    // Blob cannot do — and every one of them is dead, with the reason above it.
    janus.mockResolvedValue(
      overview({
        health: { data: null, error: 'ConnectError: All connection attempts failed' },
        config: { data: null, error: 'ConnectError: All connection attempts failed' },
      }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(await screen.findByText(/Not answering/)).toBeTruthy();
    expect((screen.getByLabelText('Model') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('config.yaml') as HTMLTextAreaElement).disabled).toBe(true);

    const before = janus.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(janus.mock.calls.length).toBeGreaterThan(before));
  });

  it('says why the controls are dead when the gateway is up and its config is not', async () => {
    // The five routes are fetched independently, so `/v1/config` — the one that makes a
    // live provider call — can fail on its own. Without this the page was a screenful of
    // disabled controls with "Answering" above them and no reason anywhere.
    janus.mockResolvedValue(
      overview({ config: { data: null, error: 'Janus rejected JANUS_API_SERVER_KEY.' } }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    expect(await screen.findByText(/did not say what it runs on/)).toBeTruthy();
    expect(screen.getByText('Janus rejected JANUS_API_SERVER_KEY.')).toBeTruthy();
    expect(screen.getByText('Answering')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Save config.yaml' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('forgets a typed key when the provider under it changes', async () => {
    // The sharpest bug the review found. `apiKeys` is keyed by the *selected* provider's
    // variable, so a key pasted for DeepSeek and then left sitting while the select moved
    // to OpenAI would be saved as `OPENAI_API_KEY` — Janus validates the name and not the
    // value, so it writes it, and the wrong provider is now holding somebody's live key.
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.change(await screen.findByLabelText('API key'), {
      target: { value: 'sk-deepseek-live-key' },
    });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai-api' } });
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Save model' }));

    await waitFor(() =>
      expect(updateJanus).toHaveBeenCalledWith({ model: { provider: 'openai-api' } }),
    );
    expect(document.body.innerHTML).not.toContain('sk-deepseek-live-key');
  });

  it('offers the six reasoning efforts Janus accepts, in Janus’s order', async () => {
    // `janus_constants.VALID_REASONING_EFFORTS` is ("minimal","low","medium","high",
    // "xhigh") and `parse_reasoning_effort` takes "none" ahead of them as "off". The
    // page invented three of the six before the review, so this is pinned by name.
    render(<JanusSection onError={vi.fn()} isOwner />);

    const effort = (await screen.findByLabelText('Reasoning effort')) as HTMLSelectElement;
    expect([...effort.options].map((option) => option.value)).toEqual([
      'none',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(effort.value).toBe('medium');
  });

  it('keeps a provider Janus is running on but does not list', async () => {
    // `_providers_view()` lists API-key providers only, so a Janus on anything else —
    // OAuth, a local model — has a `model.provider` matching no entry. An unlisted
    // current value used to leave the select blank, which made *picking anything* a
    // change of provider that nobody asked for.
    janus.mockResolvedValue(
      serverOverview({
        model: { default: 'local-model', provider: 'lmstudio', base_url: 'http://localhost:1234/v1' },
      }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    const select = (await screen.findByLabelText('Provider')) as HTMLSelectElement;
    expect(select.value).toBe('lmstudio');
    expect([...select.options].map((option) => option.value)).toContain('lmstudio');
    expect(
      (screen.getByRole('button', { name: 'Save model' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('refuses to send a number Janus refuses, and lets a timeout be switched off', async () => {
    // Janus's `_INT_KEYS` are "non-negative whole number", so 1.5 is a refusal it should
    // never have to answer. `gateway_timeout: 0` is documented as unlimited, and the old
    // `min={1}` forbade the one value that means "no limit".
    render(<JanusSection onError={vi.fn()} isOwner />);

    const idle = (await screen.findByLabelText('Inactivity timeout')) as HTMLInputElement;
    expect(idle.getAttribute('min')).toBe('0');

    fireEvent.change(screen.getByLabelText('Max turns'), { target: { value: '1.5' } });
    expect(
      (screen.getByRole('button', { name: 'Save behaviour' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText('Max turns'), { target: { value: '60' } });
    fireEvent.change(idle, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save behaviour' }));

    await waitFor(() =>
      expect(updateJanus).toHaveBeenCalledWith({ agent: { gateway_timeout: 0 } }),
    );
  });

  it('shows a dash rather than a blank select for something Janus did not say', async () => {
    janus.mockResolvedValue(
      serverOverview({
        agent: { max_turns: 60, reasoning_effort: '', gateway_timeout: 1800, personality: null },
      }),
    );

    render(<JanusSection onError={vi.fn()} isOwner />);

    const effort = (await screen.findByLabelText('Reasoning effort')) as HTMLSelectElement;
    expect(effort.value).toBe('');
    expect(effort.options[0]?.text).toBe('—');
    const personality = screen.getByLabelText('Personality') as HTMLSelectElement;
    expect(personality.value).toBe('');
    expect(personality.options[0]?.text).toBe('—');
  });

  it('keeps one poll in flight at a time', async () => {
    // A Janus that accepts the connection and never answers leaves every three-second
    // tick stacking another request on the one before it.
    vi.useFakeTimers();
    let release = () => {};
    const hung = new Promise<void>((resolve) => {
      release = resolve;
    });
    restartJanus.mockResolvedValue(applied({ restarting: true, drainTimeoutSeconds: 180 }));
    render(<JanusSection onError={vi.fn()} isOwner />);
    await settle();

    janus.mockImplementation(async () => {
      await hung;
      return serverOverview();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restart Janus' }));
    await settle();

    // Four ticks, one request: it was four requests before the guard.
    const before = janus.mock.calls.length;
    await settle(12_000);
    expect(janus.mock.calls.length - before).toBe(1);

    // The hung request lands, and the next tick is free to ask again.
    release();
    await settle(3000);
    expect(janus.mock.calls.length - before).toBeGreaterThan(1);
  });

  it('marks Janus down once a restart has not come back', async () => {
    // The overview on the screen is the healthy one from before the restart, so without
    // this the Gateway tile read "Answering" directly above "Janus has not come back
    // yet" — and every form was editable against values Janus may no longer hold.
    vi.useFakeTimers();
    restartJanus.mockResolvedValue(applied({ restarting: true, drainTimeoutSeconds: 180 }));
    render(<JanusSection onError={vi.fn()} isOwner />);
    await settle();

    fireEvent.click(screen.getByRole('button', { name: 'Restart Janus' }));
    await settle();
    janus.mockRejectedValue(new ApiError(400, 'janus_unreachable', 'Janus did not answer.'));
    await settle(220_000);

    expect(screen.getByText(/has not come back/)).toBeTruthy();
    expect(screen.getByText('Not answering')).toBeTruthy();
    expect(screen.queryByText('Answering')).toBeNull();
    expect((screen.getByLabelText('Model') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('config.yaml') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('says what Janus answered out loud, and ties it to the button that asked', async () => {
    updateJanus.mockRejectedValue(
      new ApiError(400, 'janus_refused', 'model must be a mapping', undefined, {
        issues: [{ severity: 'error', message: 'model must be a mapping', hint: 'model.default' }],
      }),
    );
    render(<JanusSection onError={vi.fn()} isOwner />);

    fireEvent.change(await screen.findByLabelText('config.yaml'), {
      target: { value: 'model: 3\n' },
    });
    const save = screen.getByRole('button', { name: 'Save config.yaml' });
    fireEvent.click(save);

    // Asserted through the wiring rather than by a role lookup: what has to hold is that
    // the button points at the element carrying the answer, and that the element is a
    // live region — a screen reader on the Save button should hear the refusal.
    await waitFor(() => expect(save.getAttribute('aria-describedby')).toBeTruthy());
    const said = document.getElementById(save.getAttribute('aria-describedby')!);
    expect(said?.getAttribute('role')).toBe('status');
    expect(said?.getAttribute('aria-live')).toBe('polite');
    expect(said?.textContent).toContain('model must be a mapping');
    // And nothing to point at while there is nothing to say.
    expect(
      screen.getByRole('button', { name: 'Save model' }).getAttribute('aria-describedby'),
    ).toBeNull();
  });
});
