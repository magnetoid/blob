// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { ForwardDialog } from './ForwardDialog.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const MESSAGE = {
  id: '01a05000-0000-7000-8000-000000000001',
  channelId: 'c1',
  authorId: 'u2',
  body: 'the original thing that was said',
  kind: 'user',
  createdAt: '2026-08-31T09:00:00.000Z',
  reactions: [],
  attachments: [],
} as unknown as Message;

function setup(overrides: Record<string, unknown> = {}) {
  const sendMessage = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
  useStore.setState({
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', membership: {}, archivedAt: null },
      c2: { id: 'c2', kind: 'public', name: 'random', membership: {}, archivedAt: null },
      c3: { id: 'c3', kind: 'public', name: 'unjoined', membership: null, archivedAt: null },
      c4: { id: 'c4', kind: 'public', name: 'retired', membership: {}, archivedAt: '2026-01-01' },
    },
    users: { u2: { id: 'u2', displayName: 'Marko Ilic', kind: 'human' } },
    sendMessage,
    ...overrides,
  } as never);
  const onClose = vi.fn();
  render(<ForwardDialog message={MESSAGE} onClose={onClose} />);
  return { sendMessage, onClose };
}

const options = () => [...document.querySelectorAll('.forward-list .menu-item')];

describe('forwarding a message', () => {
  it('offers the conversations you are actually in', () => {
    // Not one you have never joined, and not an archived one you cannot post to.
    setup();

    expect(options().map((b) => b.textContent)).toEqual(['#general', '#random']);
  });

  it('will not send until a destination is chosen', () => {
    setup();

    expect(screen.getByText('Forward').closest('button')?.disabled).toBe(true);
  });

  it('sends the note, an attributed quote, and a permalink', async () => {
    const { sendMessage } = setup();
    fireEvent.change(screen.getByPlaceholderText('Optional'), { target: { value: 'worth a look' } });
    fireEvent.click(options()[1] as HTMLElement);

    fireEvent.click(screen.getByText('Forward'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const [channelId, body] = sendMessage.mock.calls[0] as unknown as [string, string];
    expect(channelId).toBe('c2');
    expect(body).toContain('worth a look');
    expect(body).toContain('**Marko Ilic** wrote:');
    expect(body).toContain('> the original thing that was said');
    expect(body).toContain('/m/01a05000-0000-7000-8000-000000000001');
  });

  it('quotes every line, not just the first', async () => {
    // A quote whose second line is not quoted stops being a quote halfway down.
    const { sendMessage } = setup();
    useStore.setState({} as never);
    cleanup();
    const multi = { ...MESSAGE, body: 'first line\nsecond line' } as Message;
    render(<ForwardDialog message={multi} onClose={vi.fn()} />);
    fireEvent.click(options()[0] as HTMLElement);
    fireEvent.click(screen.getByText('Forward'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    const body = (sendMessage.mock.calls[0] as unknown as [string, string])[1];
    expect(body).toContain('> first line\n> second line');
  });

  it('filters the destination list', () => {
    setup();

    fireEvent.change(screen.getByPlaceholderText('Find a conversation'), { target: { value: 'rand' } });

    expect(options().map((b) => b.textContent)).toEqual(['#random']);
  });

  it('closes on Escape', () => {
    const { onClose } = setup();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });
});
