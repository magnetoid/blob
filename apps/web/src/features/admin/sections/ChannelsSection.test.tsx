// @vitest-environment happy-dom
/** Every channel, including the private ones an admin is not in. What these pin is what a
 * row says about its channel, that a direct message is never offered an Archive, and that
 * a closed channel can be opened again — it used to be permanent by omission. (What the
 * page says when the list cannot be read is in LoadFailure.test.tsx.) */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type AdminChannel } from '../../../lib/api.ts';
import { ChannelsSection } from './ChannelsSection.tsx';
import '../../../test/overlayChunk.ts';

const channel = (id: string, extra: Partial<AdminChannel> = {}): AdminChannel => ({
  id,
  kind: 'public',
  name: id,
  topic: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  archivedAt: null,
  memberCount: 4,
  messageCount: 120,
  lastMessageAt: null,
  ...extra,
});

const CHANNELS = [
  channel('general'),
  channel('board', { kind: 'private', memberCount: 1, messageCount: 1, lastMessageAt: new Date().toISOString() }),
  channel('old', { archivedAt: '2026-10-01T00:00:00.000Z' }),
  channel('dm1', { kind: 'dm', name: null }),
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api.admin, 'channels').mockResolvedValue({ channels: CHANNELS });
});

afterEach(cleanup);

describe('the channels list', () => {
  it('is a list: a name, what kind it is if not public, and how much it has been used', async () => {
    render(<ChannelsSection onError={vi.fn()} />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(4);

    expect(within(rows[0]!).getByText('#general')).toBeTruthy();
    expect(within(rows[0]!).getByText('4 members · 120 messages · never used')).toBeTruthy();
    // Public is the unmarked case.
    expect(within(rows[0]!).queryByText('public')).toBeNull();

    expect(within(rows[1]!).getByText('private')).toBeTruthy();
    expect(within(rows[1]!).getByText(/^1 members · 1 messages · active /)).toBeTruthy();

    expect(within(rows[2]!).getByText('archived')).toBeTruthy();
    expect(within(rows[3]!).getByText('Direct message')).toBeTruthy();
    expect(within(rows[3]!).getByText('dm')).toBeTruthy();
  });

  it('archives and reopens channels by name, and offers a conversation neither', async () => {
    render(<ChannelsSection onError={vi.fn()} />);
    await screen.findAllByRole('listitem');

    expect(screen.getByRole('button', { name: 'Archive #general' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reopen #old' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reopen #general' })).toBeNull();
    const dm = screen.getByText('Direct message').closest('[role="listitem"]') as HTMLElement;
    expect(within(dm).queryByRole('button')).toBeNull();
  });

  it('reopens a closed channel and reads the list again', async () => {
    const reopen = vi.spyOn(api.admin, 'unarchiveChannel').mockResolvedValue({ ok: true } as never);
    render(<ChannelsSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reopen #old' }));

    await waitFor(() => expect(reopen).toHaveBeenCalledWith('old'));
    await waitFor(() => expect(api.admin.channels).toHaveBeenCalledTimes(2));
  });

  it('asks before archiving, naming the channel, and archives only on the answer', async () => {
    const archive = vi.spyOn(api.admin, 'archiveChannel').mockResolvedValue({ ok: true } as never);
    render(<ChannelsSection onError={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive #general' }));

    const dialog = await screen.findByRole('alertdialog', { name: 'Archive #general?' });
    expect(within(dialog).getByText(/nobody can post in it again/)).toBeTruthy();
    expect(archive).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('general'));
  });

  it('says so when there are none', async () => {
    vi.spyOn(api.admin, 'channels').mockResolvedValue({ channels: [] });
    render(<ChannelsSection onError={vi.fn()} />);
    expect(await screen.findByText('No channels yet.')).toBeTruthy();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
