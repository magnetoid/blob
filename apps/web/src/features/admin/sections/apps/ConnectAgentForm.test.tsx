// @vitest-environment happy-dom
/** Connecting an agent that runs somewhere Blob cannot reach.
 *
 * It registers an agent that does not exist yet, so what matters is what is sent and what
 * is handed back: a name becomes a slug that cannot change later, the four scopes an
 * answering agent needs are on until somebody turns one off, and the token and secret that
 * come back go to whoever shows them — this form never draws them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, ApiError } from '../../../../lib/api.ts';
import { ConnectAgentForm } from './ConnectAgentForm.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CATALOG = {
  'messages:read': 'Read messages',
  'messages:write': 'Post messages',
  'channels:read': 'See channels',
  'channels:join': 'Join channels',
  'files:read': 'Read files',
};

function open(props: Partial<React.ComponentProps<typeof ConnectAgentForm>> = {}) {
  const handlers = { onConnected: vi.fn(), onError: vi.fn() };
  render(<ConnectAgentForm scopeCatalog={CATALOG} {...handlers} {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Connect an agent on your machine' }));
  return handlers;
}

const installed = (name: string) =>
  ({
    plugin: { name },
    botToken: 'bot_tok',
    signingSecret: 'whsec',
  }) as never;

describe('connecting an agent on your machine', () => {
  it('is one button, with a line on what it is for, until it is pressed', () => {
    render(<ConnectAgentForm scopeCatalog={CATALOG} onConnected={vi.fn()} onError={vi.fn()} />);
    expect(screen.getByText(/needs no public address/)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('opens onto the name, with the caret in it, and says where the agent dials in', () => {
    open();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'What is it called?' }));
    expect(screen.getByText(`${location.origin.replace(/^http/, 'ws')}/ws/agent`)).toBeTruthy();
  });

  it('says what the name will be known as, which cannot change', () => {
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'What is it called?' }), {
      target: { value: 'Desktop Claude!' },
    });
    expect(screen.getByText('desktop-claude')).toBeTruthy();
    expect(screen.getByText(/which cannot change later/)).toBeTruthy();
  });

  it('holds the button until the name makes a slug the server would take', () => {
    open();
    const button = screen.getByRole('button', { name: 'Get a token' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'What is it called?' }), { target: { value: 'ab' } });
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'What is it called?' }), { target: { value: 'abc' } });
    expect(button.disabled).toBe(false);
  });

  it('offers every scope there is, on for the four an answering agent needs and no more', () => {
    open();
    const group = screen.getByRole('group', { name: 'What may it do?' });
    expect(group).toBeTruthy();
    for (const scope of ['messages:read', 'messages:write', 'channels:read', 'channels:join']) {
      expect(screen.getByRole('checkbox', { name: scope, checked: true })).toBeTruthy();
    }
    expect(
      screen.getByRole('checkbox', { name: 'files:read', checked: false, description: 'Read files' }),
    ).toBeTruthy();
  });

  it('registers a socket agent with the scopes chosen, and hands the credentials on', async () => {
    const install = vi.spyOn(api.admin, 'installPlugin').mockResolvedValue(installed('Desktop Claude'));
    const { onConnected, onError } = open();
    fireEvent.change(screen.getByRole('textbox', { name: 'What is it called?' }), {
      target: { value: ' Desktop Claude ' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'channels:join' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'files:read' }));
    fireEvent.click(screen.getByRole('button', { name: 'Get a token' }));

    await waitFor(() =>
      expect(install).toHaveBeenCalledWith({
        slug: 'desktop-claude',
        name: 'Desktop Claude',
        runtime: 'socket',
        version: '1.0.0',
        events: [],
        scopes: ['messages:read', 'messages:write', 'channels:read', 'files:read'],
      }),
    );
    await waitFor(() => expect(onConnected).toHaveBeenCalledWith('Desktop Claude', 'bot_tok', 'whsec'));
    expect(onError).toHaveBeenCalledWith(null);
    // Handed on, not shown here: the form is put away and holds neither.
    expect(screen.queryByText('bot_tok')).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connect an agent on your machine' })).toBeTruthy(),
    );
  });

  it('registers on Enter in the name field', async () => {
    const install = vi.spyOn(api.admin, 'installPlugin').mockResolvedValue(installed('Helper'));
    open();
    const name = screen.getByRole('textbox', { name: 'What is it called?' });
    fireEvent.change(name, { target: { value: 'Helper' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1));
  });

  it('says why when the server refused, and keeps what was typed', async () => {
    vi.spyOn(api.admin, 'installPlugin').mockRejectedValue(
      new ApiError(409, 'conflict', 'That slug is taken.'),
    );
    const { onConnected, onError } = open();
    fireEvent.change(screen.getByRole('textbox', { name: 'What is it called?' }), { target: { value: 'Helper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get a token' }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith('That slug is taken.'));
    expect(onConnected).not.toHaveBeenCalled();
    expect((screen.getByRole('textbox', { name: 'What is it called?' }) as HTMLInputElement).value).toBe('Helper');
  });

  it('puts the form away on Cancel', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'What is it called?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect an agent on your machine' })).toBeTruthy();
  });
});
