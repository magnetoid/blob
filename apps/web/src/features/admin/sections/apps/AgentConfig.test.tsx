// @vitest-environment happy-dom
/** What a hosted agent is configured with.
 *
 * The two things that are load-bearing, per the component's own account: a secret is
 * described and never printed, and a key the runner holds twice is shown as one thing to
 * fix. Around them, the edits: what is sent when someone saves, with or without the
 * restart that makes it live.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, ApiError, type AgentEnvVar } from '../../../../lib/api.ts';
import { AgentConfig } from './AgentConfig.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (over: Partial<AgentEnvVar>): AgentEnvVar => ({
  key: 'MODEL',
  value: 'gpt-5',
  hint: null,
  secret: false,
  managed: false,
  duplicated: false,
  ...over,
});

const ENV = {
  env: [
    row({}),
    row({ key: 'OPENAI_API_KEY', value: null, hint: '73 characters, ending a4f2', secret: true }),
    row({ key: 'BLOB_URL', value: 'https://blob.example.com', managed: true }),
  ],
  reserved: ['BLOB_URL', 'BLOB_BOT_TOKEN'],
};

function open(env = ENV) {
  vi.spyOn(api.admin, 'agentEnv').mockResolvedValue(env);
  const onError = vi.fn();
  render(<AgentConfig pluginId="p1" onError={onError} />);
  return { onError };
}

describe('what the agent is configured with', () => {
  it('says it is reading, then lists a key to a row', async () => {
    open();
    expect(screen.getByText('Reading configuration…')).toBeTruthy();
    const table = await screen.findByRole('table', { name: 'Configuration' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect((screen.getByRole('textbox', { name: 'MODEL' }) as HTMLInputElement).value).toBe('gpt-5');
  });

  it('describes a secret and never prints it', async () => {
    open();
    const key = (await screen.findByLabelText('OPENAI_API_KEY')) as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.value).toBe('');
    expect(key.placeholder).toBe('73 characters, ending a4f2');
  });

  it('shows what the runner writes as fixed text, with nothing to edit or remove', async () => {
    open();
    await screen.findByRole('table');
    expect(screen.getByText('https://blob.example.com')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'BLOB_URL' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove BLOB_URL' })).toBeNull();
    expect(screen.getByText('runner')).toBeTruthy();
    expect(screen.getByText(/Blob sets BLOB_URL, BLOB_BOT_TOKEN itself\./)).toBeTruthy();
  });

  it('shows a key held twice once, and says so', async () => {
    open({
      env: [row({ key: 'MODEL', value: 'a', duplicated: true }), row({ key: 'MODEL', value: 'b', duplicated: true })],
      reserved: [],
    });
    expect(await screen.findByText('Set twice: MODEL.')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(1);
    expect(screen.getByText('set twice')).toBeTruthy();
  });

  it('holds both saves until something is changed', async () => {
    open();
    await screen.findByRole('table');
    expect((screen.getByRole('button', { name: 'Save and restart' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save only' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'MODEL' }), { target: { value: 'gpt-6' } });
    expect((screen.getByRole('button', { name: 'Save and restart' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends an edit with a restart, and says it saved', async () => {
    const save = vi.spyOn(api.admin, 'saveAgentEnv').mockResolvedValue(ENV);
    open();
    fireEvent.change(await screen.findByRole('textbox', { name: 'MODEL' }), { target: { value: 'gpt-6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and restart' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('p1', { set: { MODEL: 'gpt-6' }, remove: [], restart: true }),
    );
    expect(await screen.findByText('Saved')).toBeTruthy();
  });

  it('sends a secret typed in, without a restart if asked', async () => {
    const save = vi.spyOn(api.admin, 'saveAgentEnv').mockResolvedValue(ENV);
    open();
    fireEvent.change(await screen.findByLabelText('OPENAI_API_KEY'), { target: { value: 'sk-new' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save only' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('p1', { set: { OPENAI_API_KEY: 'sk-new' }, remove: [], restart: false }),
    );
  });

  it('strikes a key for removal before it is removed, and lets it be kept', async () => {
    const save = vi.spyOn(api.admin, 'saveAgentEnv').mockResolvedValue(ENV);
    open();
    const remove = await screen.findByRole('button', { name: 'Remove MODEL' });
    fireEvent.click(remove);
    expect((screen.getByRole('textbox', { name: 'MODEL' }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Keep MODEL' }));
    expect((screen.getByRole('textbox', { name: 'MODEL' }) as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Save only' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove MODEL' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save only' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('p1', { set: {}, remove: ['MODEL'], restart: false }),
    );
  });

  it('adds a new key, in capitals', async () => {
    const save = vi.spyOn(api.admin, 'saveAgentEnv').mockResolvedValue(ENV);
    open();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('textbox', { name: 'New key' }), { target: { value: 'timeout_s' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'New value' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and restart' }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith('p1', { set: { TIMEOUT_S: '30' }, remove: [], restart: true }),
    );
  });

  it('says why when it could not save, and keeps the edit', async () => {
    vi.spyOn(api.admin, 'saveAgentEnv').mockRejectedValue(new ApiError(502, 'runner_down', 'The runner is down.'));
    const { onError } = open();
    fireEvent.change(await screen.findByRole('textbox', { name: 'MODEL' }), { target: { value: 'gpt-6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save only' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('The runner is down.'));
    expect((screen.getByRole('textbox', { name: 'MODEL' }) as HTMLInputElement).value).toBe('gpt-6');
  });

  it('says so when it could not be read', async () => {
    vi.spyOn(api.admin, 'agentEnv').mockRejectedValue(new Error('down'));
    const onError = vi.fn();
    render(<AgentConfig pluginId="p1" onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not read this agent’s configuration.'));
  });
});
