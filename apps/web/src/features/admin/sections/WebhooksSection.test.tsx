// @vitest-environment happy-dom
/**
 * Admin → Webhooks: URLs that let another system post into a channel. What these pin is the
 * part that cannot be done over: the address is shown once, in a field that can be read
 * whole and copied, and is gone when it is dismissed; and revoking asks first, because
 * whatever posts through the URL stops at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type AdminWebhook } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';
import { WebhooksSection } from './WebhooksSection.tsx';
import '../../../test/overlayChunk.ts';

const hook = (id: string, extra: Partial<AdminWebhook> = {}): AdminWebhook => ({
  id,
  name: `Hook ${id}`,
  channelId: 'c1',
  createdAt: '2026-10-01T09:00:00.000Z',
  lastUsedAt: null,
  url: null,
  ...extra,
});

const SECRET_URL = 'https://blob.example.com/hooks/h-9f3a-must-be-shown-once';

beforeEach(() => {
  useStore.setState({
    channels: {
      c1: { id: 'c1', name: 'general', kind: 'public', archivedAt: null },
      c2: { id: 'c2', name: 'deploys', kind: 'public', archivedAt: null },
      c3: { id: 'c3', name: 'old', kind: 'public', archivedAt: '2026-01-01T00:00:00.000Z' },
    },
  } as never);
  vi.spyOn(api.admin, 'webhooks').mockResolvedValue({
    webhooks: [hook('a', { name: 'CI', lastUsedAt: new Date().toISOString() }), hook('b')],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a new webhook', () => {
  it('offers the channels that are open, and sends the one chosen with the name given', async () => {
    const create = vi
      .spyOn(api.admin, 'createWebhook')
      .mockResolvedValue(hook('n', { name: 'Deploys', url: SECRET_URL }));
    render(<WebhooksSection onError={vi.fn()} />);

    const channel = await screen.findByRole('combobox', { name: 'Channel' });
    // An archived channel cannot be posted into, so it is not offered.
    expect([...(channel as HTMLSelectElement).options].map((option) => option.text)).toEqual([
      'Pick one',
      '#general',
      '#deploys',
    ]);

    // Nothing is sent without both.
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(channel, { target: { value: 'c2' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Deploys' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('c2', 'Deploys'));
  });

  it('shows the address once, in a field to read and copy it from, until it is dismissed', async () => {
    vi.spyOn(api.admin, 'createWebhook').mockResolvedValue(hook('n', { url: SECRET_URL }));
    render(<WebhooksSection onError={vi.fn()} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Channel' }), {
      target: { value: 'c1' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'CI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    const field = (await screen.findByRole('textbox', { name: 'Webhook URL' })) as HTMLInputElement;
    expect(field.value).toBe(SECRET_URL);
    expect(field.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    // The form is ready for the next one.
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('textbox', { name: 'Webhook URL' })).toBeNull();
    // Gone from the page, not just from sight: it was never kept anywhere a title or a
    // label could show it.
    expect(document.body.textContent).not.toContain(SECRET_URL);
  });

  it('puts a refusal where the console shows errors', async () => {
    const onError = vi.fn();
    vi.spyOn(api.admin, 'createWebhook').mockRejectedValue(new Error('no'));
    render(<WebhooksSection onError={onError} />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'Channel' }), {
      target: { value: 'c1' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'CI' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('That did not work.'));
    expect(screen.queryByRole('textbox', { name: 'Webhook URL' })).toBeNull();
  });
});

describe('the webhooks that exist', () => {
  it('are a list: the name, and when each was last used or that it never was', async () => {
    render(<WebhooksSection onError={vi.fn()} />);
    const rows = within(await screen.findByRole('list', { name: 'Webhooks' })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('CI')).toBeTruthy();
    expect(within(rows[0]!).getByText(/^Last used /)).toBeTruthy();
    expect(within(rows[1]!).getByText('Hook b')).toBeTruthy();
    expect(within(rows[1]!).getByText('Never used')).toBeTruthy();
  });

  it('are revoked only after asking, by name', async () => {
    const revoke = vi.spyOn(api.admin, 'revokeWebhook').mockResolvedValue({ ok: true });
    render(<WebhooksSection onError={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Revoke CI' }));
    expect(revoke).not.toHaveBeenCalled();
    expect(await screen.findByText('Revoke “CI”?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('a'));
  });

  it('say so when there are none, and say nothing at all when they could not be read', async () => {
    vi.spyOn(api.admin, 'webhooks').mockResolvedValue({ webhooks: [] });
    const { unmount } = render(<WebhooksSection onError={vi.fn()} />);
    expect(await screen.findByText('No webhooks yet.')).toBeTruthy();
    unmount();

    // "No webhooks yet" would be a claim about webhooks it never read.
    const onError = vi.fn();
    vi.spyOn(api.admin, 'webhooks').mockRejectedValue(new Error('down'));
    render(<WebhooksSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load webhooks.'));
    expect(screen.queryByText('No webhooks yet.')).toBeNull();
  });
});
