// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BrowseChannels } from './BrowseChannels.tsx';
import { api } from '../../lib/api.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CHANNELS = [
  {
    id: 'c1', name: 'general', topic: null, description: 'Company-wide',
    createdAt: '2026-01-01T00:00:00.000Z', archivedAt: null, memberCount: 4, joined: true,
  },
  {
    id: 'c2', name: 'watercooler', topic: 'Anything but work', description: null,
    createdAt: '2026-01-01T00:00:00.000Z', archivedAt: null, memberCount: 1, joined: false,
  },
];

function stubBrowse(channels = CHANNELS) {
  return vi.spyOn(api.channels, 'browse').mockResolvedValue({ channels });
}

describe('the channel directory', () => {
  it('lists channels with their member count', async () => {
    stubBrowse();
    render(<BrowseChannels />);

    await screen.findByText('general');
    expect(screen.getByText(/4 members/)).toBeTruthy();
  });

  it('shows the topic when there is no description', async () => {
    // Both are "what is this channel for", written in different boxes.
    stubBrowse();
    render(<BrowseChannels />);

    await waitFor(() => expect(screen.getByText(/Anything but work/)).toBeTruthy());
  });

  it('offers Join for a channel you are not in, and Open for one you are', async () => {
    stubBrowse();
    const { container } = render(<BrowseChannels />);

    await screen.findByText('watercooler');
    const labels = [...container.querySelectorAll('.browse-row button')].map(b => b.textContent);
    expect(labels).toEqual(['Open', 'Join']);
  });

  it('asks the server again when the search changes', async () => {
    const browse = stubBrowse();
    render(<BrowseChannels />);
    await screen.findByText('general');

    fireEvent.change(screen.getByLabelText('Search channels'), { target: { value: 'water' } });

    // Debounced, so it is the eventual call that matters, not an immediate one.
    await waitFor(() => expect(browse).toHaveBeenCalledWith('water', false));
  });

  it('asks for archived channels only when the toggle is on', async () => {
    const browse = stubBrowse();
    render(<BrowseChannels />);
    await screen.findByText('general');

    fireEvent.click(screen.getByText('Include archived'));

    await waitFor(() => expect(browse).toHaveBeenCalledWith('', true));
  });

  it('says so when nothing matches, naming what was searched for', async () => {
    const browse = stubBrowse();
    render(<BrowseChannels />);
    await screen.findByText('general');
    browse.mockResolvedValue({ channels: [] });

    fireEvent.change(screen.getByLabelText('Search channels'), { target: { value: 'zzz' } });

    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeTruthy());
  });

  it('surfaces a failure rather than showing an empty directory', async () => {
    // An empty list and a broken request look identical otherwise, and one of them
    // means "there are no channels".
    vi.spyOn(api.channels, 'browse').mockRejectedValue(new Error('the server said no'));
    render(<BrowseChannels />);

    await waitFor(() => expect(screen.getByText('the server said no')).toBeTruthy());
  });
});
