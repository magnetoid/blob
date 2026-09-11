// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const listFiles = vi.fn();
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, files: { list: (...a: unknown[]) => listFiles(...a) } } };
});

const { FilesView } = await import('./FilesView.tsx');

afterEach(cleanup);

beforeEach(() => {
  listFiles.mockReset();
  listFiles.mockResolvedValue({
    items: [
      {
        id: 'a1',
        filename: 'shot.png',
        mime: 'image/png',
        sizeBytes: 12,
        width: 800,
        height: 600,
        url: '/api/files/orig.png',
        thumbUrl: '/api/files/orig.png.thumb.webp',
        channelId: 'c1',
        messageId: 'm1',
        createdAt: '2026-09-11T00:00:00.000Z',
      },
    ],
    nextCursor: null,
  });
});

describe('FilesView', () => {
  it('renders thumbnails from the listing, not the original', async () => {
    render(<FilesView />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'shot.png' })).toBeTruthy());
    const img = screen.getByRole('button', { name: 'shot.png' }).querySelector('img');
    expect(img?.getAttribute('src')).toBe('/api/files/orig.png.thumb.webp');
  });

  it('filters to images without loading originals', async () => {
    render(<FilesView />);
    await waitFor(() => expect(listFiles).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Images' }));
    await waitFor(() => expect(listFiles).toHaveBeenCalledWith({ kind: 'image' }));
  });
});
