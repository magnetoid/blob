// @vitest-environment happy-dom
/** Registering an external app by hand: where it listens, what it subscribes to, what it
 * may do. What these pin is what is sent — blanks are not sent as empty strings, the two
 * lists are the ones ticked — and that every field is named and every tick says what it
 * grants. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, ApiError, type AdminPluginCatalog } from '../../../../lib/api.ts';
import { InstallAppForm } from './InstallAppForm.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CATALOG: AdminPluginCatalog = {
  events: { 'message.created': 'A message is posted', 'channel.created': 'A channel is made' },
  scopes: { 'messages:read': 'Read messages', 'messages:write': 'Post messages' },
};

function show(catalog: AdminPluginCatalog | null = CATALOG) {
  const handlers = { onError: vi.fn(), onInstalled: vi.fn() };
  render(<InstallAppForm catalog={catalog} {...handlers} />);
  return handlers;
}

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });

describe('registering an app', () => {
  it('names every field, and says what the two addresses are for', () => {
    show();
    for (const name of ['Slug', 'Name', 'Description', 'Version']) {
      expect(screen.getByRole('textbox', { name })).toBeTruthy();
    }
    expect(
      screen.getByRole('textbox', { name: 'Request URL', description: /Where Blob POSTs the events/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'AG-UI URL', description: /For an agent that speaks AG-UI/ }),
    ).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Version' }) as HTMLInputElement).value).toBe('1.0.0');
  });

  it('offers each event and each permission, with what ticking it means', () => {
    show();
    const events = screen.getByRole('group', { name: 'Event subscriptions' });
    expect(
      within(events).getByRole('checkbox', {
        name: 'message.created',
        checked: false,
        description: 'A message is posted',
      }),
    ).toBeTruthy();
    const scopes = screen.getByRole('group', { name: 'Granted scopes' });
    expect(
      within(scopes).getByRole('checkbox', {
        name: 'messages:write',
        description: 'Post messages',
      }),
    ).toBeTruthy();
  });

  it('offers none until the catalogue arrives', () => {
    show(null);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('sends what was filled in, trimmed, and what was ticked — and a blank as nothing', async () => {
    const install = vi.spyOn(api.admin, 'installPlugin').mockResolvedValue({
      plugin: { name: 'Standup Bot' },
      signingSecret: 'whsec',
      botToken: 'bot',
    } as never);
    const { onInstalled, onError } = show();
    type('Slug', ' standup-bot ');
    type('Name', ' Standup Bot ');
    type('Request URL', 'https://apps.example.com/blob/events');
    fireEvent.click(screen.getByRole('checkbox', { name: 'message.created' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'messages:read' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'messages:write' }));
    // Ticked, then unticked: not sent.
    fireEvent.click(screen.getByRole('checkbox', { name: 'messages:write' }));
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));

    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({
        slug: 'standup-bot',
        name: 'Standup Bot',
        description: null,
        runtime: 'external',
        version: '1.0.0',
        requestUrl: 'https://apps.example.com/blob/events',
        aguiUrl: null,
        events: ['message.created'],
        scopes: ['messages:read'],
      }),
    );
    await waitFor(() =>
      expect(onInstalled).toHaveBeenCalledWith({
        pluginName: 'Standup Bot',
        signingSecret: 'whsec',
        botToken: 'bot',
      }),
    );
    expect(onError).toHaveBeenCalledWith(null);
    // The form starts over for the next one.
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Slug' }) as HTMLInputElement).value).toBe(''));
    expect(screen.getByRole('checkbox', { name: 'message.created', checked: false })).toBeTruthy();
  });

  it('says why when the server refused, and keeps what was typed', async () => {
    vi.spyOn(api.admin, 'installPlugin').mockRejectedValue(new ApiError(400, 'invalid_input', 'Slug is taken.'));
    const { onInstalled, onError } = show();
    type('Slug', 'standup-bot');
    type('Name', 'Standup Bot');
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Slug is taken.'));
    expect(onInstalled).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'Slug' }) as HTMLInputElement).value).toBe('standup-bot');
  });

  it('has a line of its own for anything else going wrong', async () => {
    vi.spyOn(api.admin, 'installPlugin').mockRejectedValue(new Error('down'));
    const { onError } = show();
    type('Slug', 'standup-bot');
    type('Name', 'Standup Bot');
    fireEvent.click(screen.getByRole('button', { name: 'Install app' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not install the app.'));
  });
});
