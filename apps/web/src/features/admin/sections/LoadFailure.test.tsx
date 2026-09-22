// @vitest-environment happy-dom
/** A console list whose first load fails.
 *
 * The page's error strip says what went wrong; what these pin is that the card under it
 * does not contradict it. Channels said "Loading…" for ever — its list starts as null and
 * only an answer ever changed that — and the others fell through to their "none yet"
 * line, a claim about rows nobody read. The loading line itself is pinned too, because the
 * easy fix for the first bug is to stop showing it at all. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api.ts';
import { ChannelsSection } from './ChannelsSection.tsx';
import { DeliveriesSection } from './DeliveriesSection.tsx';
import { GroupsSection } from './GroupsSection.tsx';
import { LogsSection } from './LogsSection.tsx';
import { WebhooksSection } from './WebhooksSection.tsx';

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

afterEach(cleanup);

const down = () => Promise.reject(new Error('down'));
const never = () => new Promise<never>(() => {});

describe('Channels', () => {
  it('says it is loading while the first answer is on its way', async () => {
    const channels = vi.spyOn(api.admin, 'channels').mockImplementation(never);
    render(<ChannelsSection onError={vi.fn()} />);
    await waitFor(() => expect(channels).toHaveBeenCalled());
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('after a failed load, leaves the page to the error', async () => {
    vi.spyOn(api.admin, 'channels').mockImplementation(down);
    const onError = vi.fn();
    const { container } = render(<ChannelsSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load channels.'));
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('No channels yet.')).toBeNull();
    expect(container.querySelector('.console-card')).toBeNull();
  });
});

describe('Webhooks', () => {
  it('after a failed load, keeps the form and claims nothing about the list', async () => {
    vi.spyOn(api.admin, 'webhooks').mockImplementation(down);
    const onError = vi.fn();
    render(<WebhooksSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load webhooks.'));
    expect(screen.getByRole('heading', { name: 'New webhook' })).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('No webhooks yet.')).toBeNull();
  });
});

describe('Deliveries', () => {
  it('after a failed load, draws no card', async () => {
    vi.spyOn(api.admin, 'workspaceDeliveries').mockImplementation(down);
    const onError = vi.fn();
    const { container } = render(<DeliveriesSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load deliveries.'));
    expect(container.querySelector('.console-card')).toBeNull();
    expect(screen.queryByText(/No delivery attempts/)).toBeNull();
  });
});

describe('Errors and logs', () => {
  it('after a failed load, does not say that nothing has gone wrong', async () => {
    vi.spyOn(api.admin, 'serverLogs').mockImplementation(down);
    const onError = vi.fn();
    render(<LogsSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not read the log.'));
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText(/Nothing has gone wrong/)).toBeNull();
  });
});

describe('One group’s members', () => {
  it('after a failed load, stops saying it is loading', async () => {
    vi.spyOn(api.admin, 'groups').mockImplementation(down);
    vi.spyOn(api.admin, 'groupMembers').mockImplementation(down);
    const onError = vi.fn();
    render(<GroupsSection onError={onError} isOwner detailId="g1" />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not load that group.'));
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('Nobody is in this group yet.')).toBeNull();
  });
});
