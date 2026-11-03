// @vitest-environment happy-dom
/**
 * Admin → Deliveries: every app's recent deliveries, newest first, and a Replay on the ones
 * that did not arrive. What these pin is what a row says (which app, which event, how it
 * ended), that Replay is offered only where there is something to send again — and names
 * the delivery it is for, since every failed row has one — and the two states that are not a
 * list: still asking, and asked and failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type AdminWorkspaceDelivery } from '../../../lib/api.ts';
import { DeliveriesSection } from './DeliveriesSection.tsx';

const delivery = (
  id: string,
  extra: Partial<AdminWorkspaceDelivery> = {},
): AdminWorkspaceDelivery => ({
  id,
  pluginId: 'p1',
  pluginName: 'Scout',
  event: 'message.created',
  status: 'delivered',
  attempts: 1,
  lastStatusCode: 200,
  lastError: null,
  createdAt: new Date().toISOString(),
  deliveredAt: new Date().toISOString(),
  ...extra,
});

beforeEach(() => {
  vi.spyOn(api.admin, 'workspaceDeliveries').mockResolvedValue({
    deliveries: [
      delivery('d1'),
      delivery('d2', {
        pluginId: 'p2',
        pluginName: 'Hooks',
        event: 'reaction.added',
        status: 'failed',
        attempts: 3,
        lastStatusCode: 502,
        lastError: 'bad gateway',
        deliveredAt: null,
      }),
      delivery('d3', { status: 'dead', attempts: 8, lastStatusCode: null, deliveredAt: null }),
    ],
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the deliveries list', () => {
  it('is a row for each attempt: the app, the event, how it ended and what it said', async () => {
    render(<DeliveriesSection onError={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Deliveries' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    expect(within(rows[0]!).getByText('Scout')).toBeTruthy();
    expect(within(rows[0]!).getByText('message.created')).toBeTruthy();
    expect(within(rows[0]!).getByText('delivered')).toBeTruthy();

    expect(within(rows[1]!).getByText('Hooks')).toBeTruthy();
    expect(within(rows[1]!).getByText('failed')).toBeTruthy();
    const said = within(rows[1]!).getByText(/3 attempts/);
    expect(said.textContent).toMatch(/HTTP 502/);
    expect(said.textContent).toMatch(/bad gateway/);
  });

  it('offers Replay on a delivery that failed or died, and on no other', async () => {
    const replay = vi
      .spyOn(api.admin, 'replayPluginDelivery')
      .mockResolvedValue(delivery('d2', { status: 'pending' }));
    render(<DeliveriesSection onError={vi.fn()} />);
    const rows = within(await screen.findByRole('list', { name: 'Deliveries' })).getAllByRole(
      'listitem',
    );

    expect(within(rows[0]!).queryByRole('button')).toBeNull();
    // Named for the delivery, as every failed row has one.
    expect(
      within(rows[2]!).getByRole('button', { name: 'Replay message.created to Scout' }),
    ).toBeTruthy();
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Replay reaction.added to Hooks' }));
    await waitFor(() => expect(replay).toHaveBeenCalledWith('p2', 'd2'));
    // Asked again afterwards, so the row shows what became of it.
    await waitFor(() => expect(api.admin.workspaceDeliveries).toHaveBeenCalledTimes(2));
  });

  it('puts a refusal where the console shows errors, and keeps the list', async () => {
    const onError = vi.fn();
    vi.spyOn(api.admin, 'replayPluginDelivery').mockRejectedValue(new Error('no'));
    render(<DeliveriesSection onError={onError} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Replay reaction.added to Hooks' }),
    );
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('That did not work.'));
    expect(screen.getByRole('list', { name: 'Deliveries' })).toBeTruthy();
  });

  it('says so when no delivery was attempted', async () => {
    vi.spyOn(api.admin, 'workspaceDeliveries').mockResolvedValue({ deliveries: [] });
    render(<DeliveriesSection onError={vi.fn()} />);
    expect(await screen.findByText('No delivery attempts recorded yet.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Deliveries' })).toBeNull();
  });

  it('says it is loading, and claims nothing when the load failed', async () => {
    vi.spyOn(api.admin, 'workspaceDeliveries').mockReturnValue(new Promise(() => {}));
    const { unmount } = render(<DeliveriesSection onError={vi.fn()} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    unmount();

    // "No delivery attempts recorded yet" would be a claim about deliveries it never read.
    const onError = vi.fn();
    vi.spyOn(api.admin, 'workspaceDeliveries').mockRejectedValue(new Error('down'));
    render(<DeliveriesSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load deliveries.'));
    expect(screen.queryByText(/No delivery attempts/)).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});
