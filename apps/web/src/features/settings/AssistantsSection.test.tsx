// @vitest-environment happy-dom
/**
 * The one screen where somebody hands out a credential that acts as them.
 *
 * So what is pinned here is not the layout: it is that the panel says "as you" before the
 * token exists, that posting is off unless it is deliberately turned on, that the secret
 * appears exactly once and inside a command that needs no editing, and that revoking is
 * behind a confirmation. Every one of those has a wrong version that still renders fine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssistantsSection } from './AssistantsSection.tsx';
import { api, type OAuthGrant } from '../../lib/api.ts';

const TOKEN = {
  id: 't1',
  name: 'Claude Code',
  scopes: ['read'],
  createdAt: '2026-09-06T09:00:00.000Z',
  lastUsedAt: null as string | null,
  expiresAt: null as string | null,
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

const GRANT: OAuthGrant = {
  id: 'g1',
  clientName: 'Claude',
  vouchedBy: 'claude.ai',
  scopes: ['read'],
  createdAt: '2026-10-20T09:00:00.000Z',
  lastUsedAt: '2026-10-20T10:00:00.000Z',
};

function seed(tokens = [TOKEN], grants: OAuthGrant[] = []) {
  vi.spyOn(api.assistants, 'list').mockResolvedValue({
    tokens,
    url: 'https://blob.example.com/api/mcp',
  } as never);
  vi.spyOn(api.oauth, 'grants').mockResolvedValue({
    grants,
    url: 'https://blob.example.com/api/mcp',
  });
}

async function draw() {
  render(<AssistantsSection onError={vi.fn()} isOwner={false} />);
  await waitFor(() => expect(api.assistants.list).toHaveBeenCalled());
}

describe('connecting an assistant', () => {
  it('says whose eyes it will be looking through before anything is minted', async () => {
    seed([]);
    await draw();
    expect(screen.getByText(/as you/i)).toBeTruthy();
    expect(screen.getByText(/None yet. Make one above/)).toBeTruthy();
  });

  it('mints a read-only connection unless posting is asked for', async () => {
    seed([]);
    const create = vi
      .spyOn(api.assistants, 'create')
      .mockResolvedValue({ token: TOKEN, secret: 's3cret', url: 'https://b/api/mcp' } as never);
    await draw();

    fireEvent.change(screen.getByLabelText('Connection name'), {
      target: { value: 'Laptop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Get a token' }));

    // Ninety days unless another lifetime is chosen: every connection ends.
    await waitFor(() => expect(create).toHaveBeenCalledWith('Laptop', false, 90));
  });

  it('asks for write only when the box is ticked', async () => {
    seed([]);
    const create = vi
      .spyOn(api.assistants, 'create')
      .mockResolvedValue({
        token: { ...TOKEN, scopes: ['read', 'write'] },
        secret: 's3cret',
        url: 'https://b/api/mcp',
      } as never);
    await draw();

    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Laptop' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Get a token' }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('Laptop', true, 90));
    expect(await screen.findByText(/It can also post/)).toBeTruthy();
  });

  it('will not mint a nameless connection', async () => {
    seed([]);
    await draw();
    expect((screen.getByRole('button', { name: 'Get a token' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows the token inside a command that needs no editing', async () => {
    seed([]);
    vi.spyOn(api.assistants, 'create').mockResolvedValue({
      token: TOKEN,
      secret: 'the-only-copy',
      url: 'https://blob.example.com/api/mcp',
    } as never);
    await draw();

    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Laptop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get a token' }));

    expect(await screen.findByText(/shown once/i)).toBeTruthy();
    // The whole point of substituting it: no placeholder to fill in by hand.
    const commands = screen.getAllByText(/claude mcp add/).map((node) => node.textContent);
    expect(commands).toContain(
      'claude mcp add --transport http blob https://blob.example.com/api/mcp ' +
        '--header "Authorization: Bearer the-only-copy"',
    );
    expect(screen.getByText(/reads only/)).toBeTruthy();
  });
});

describe('the connections you already have', () => {
  it('says which of them can post and which have never dialled in', async () => {
    seed([
      TOKEN,
      { ...TOKEN, id: 't2', name: 'Editor', scopes: ['read', 'write'], lastUsedAt: '2026-09-06T10:00:00.000Z' },
    ]);
    await draw();

    expect(await screen.findByText('reads only')).toBeTruthy();
    expect(screen.getByText('reads and posts')).toBeTruthy();
    expect(screen.getByText(/has not connected yet/)).toBeTruthy();
    expect(screen.getByText(/Last used/)).toBeTruthy();
  });

  it('revokes only after the second press, and names what it is revoking', async () => {
    seed();
    const revoke = vi.spyOn(api.assistants, 'revoke').mockResolvedValue({ ok: true } as never);
    await draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(revoke).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke Claude Code' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('t1'));
  });

  it('lets a second thought put it back', async () => {
    seed();
    const revoke = vi.spyOn(api.assistants, 'revoke').mockResolvedValue({ ok: true } as never);
    await draw();

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy();
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('how long a connection lasts', () => {
  it('is chosen when it is made, and shown on every connection', async () => {
    seed([{ ...TOKEN, expiresAt: '2099-01-02T09:00:00.000Z' }]);
    const create = vi
      .spyOn(api.assistants, 'create')
      .mockResolvedValue({ token: TOKEN, secret: 's3cret', url: 'https://b/api/mcp' } as never);
    await draw();

    expect(screen.getByText(/ends .*2099/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: 'Laptop' } });
    fireEvent.change(screen.getByLabelText('How long it lasts'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Get a token' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('Laptop', false, 30));
  });

  it('says so when one has ended', async () => {
    seed([{ ...TOKEN, expiresAt: '2001-01-02T09:00:00.000Z' }]);
    await draw();
    expect(screen.getByText(/ended .*it no longer connects/)).toBeTruthy();
  });
});

describe('an assistant that signs in', () => {
  it('is given the connector address, and Claude Code a line with no secret in it', async () => {
    seed([]);
    await draw();
    expect(await screen.findByText('https://blob.example.com/api/mcp')).toBeTruthy();
    const commands = screen.getAllByText(/claude mcp add/).map((node) => node.textContent);
    expect(commands).toEqual(['claude mcp add --transport http blob https://blob.example.com/api/mcp']);
    expect(screen.getByText(/None yet. When an assistant signs in/)).toBeTruthy();
  });

  it('lists what it connected as, who confirms it, and disconnects only when asked twice', async () => {
    seed([], [GRANT, { ...GRANT, id: 'g2', clientName: 'Inspector', vouchedBy: null, scopes: ['read', 'write'] }]);
    const disconnect = vi.spyOn(api.oauth, 'disconnect').mockResolvedValue({ ok: true });
    await draw();

    expect(await screen.findByText(/Confirmed by claude\.ai/)).toBeTruthy();
    expect(screen.getByText(/Registered itself/)).toBeTruthy();
    expect(screen.getByText('reads and posts')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Disconnect' })[0]!);
    expect(disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Claude' }));
    await waitFor(() => expect(disconnect).toHaveBeenCalledWith('g1'));
  });
});
