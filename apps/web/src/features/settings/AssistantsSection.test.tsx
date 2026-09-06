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
import { api } from '../../lib/api.ts';

const TOKEN = {
  id: 't1',
  name: 'Claude Code',
  scopes: ['read'],
  createdAt: '2026-09-06T09:00:00.000Z',
  lastUsedAt: null as string | null,
};

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

function seed(tokens = [TOKEN]) {
  vi.spyOn(api.assistants, 'list').mockResolvedValue({
    tokens,
    url: 'https://blob.example.com/api/mcp',
  } as never);
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
    expect(screen.getByText(/None yet/)).toBeTruthy();
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

    await waitFor(() => expect(create).toHaveBeenCalledWith('Laptop', false));
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

    await waitFor(() => expect(create).toHaveBeenCalledWith('Laptop', true));
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

    const command = await screen.findByText(/claude mcp add/);
    // The whole point of substituting it: no placeholder to fill in by hand.
    expect(command.textContent).toContain('https://blob.example.com/api/mcp');
    expect(command.textContent).toContain('Authorization: Bearer the-only-copy');
    expect(screen.getByText(/shown once/i)).toBeTruthy();
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
