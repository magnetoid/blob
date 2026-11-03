// @vitest-environment happy-dom
/** The exports card (M3 · B4): what each export says, and Download only once it is built. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type ExportEntry } from '../../lib/api.ts';
import { ExportsCard } from './ExportsCard.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const entry = (patch: Partial<ExportEntry>): ExportEntry => ({
  id: 'e1',
  scope: 'personal',
  status: 'done',
  bytes: 2048,
  error: null,
  createdAt: '2026-10-21T09:00:00.000Z',
  finishedAt: '2026-10-21T09:01:00.000Z',
  requestedByName: 'Max Member',
  downloadUrl: '/api/exports/e1/download',
  ...patch,
});

describe('the exports card', () => {
  it('lists what was built, with a download for the ready ones', async () => {
    vi.spyOn(api.me, 'exports').mockResolvedValue({
      exports: [
        entry({}),
        entry({ id: 'e2', status: 'failed', bytes: null, error: 'the bucket is gone', downloadUrl: null }),
      ],
    });
    render(<ExportsCard scope="personal" title="Export your data" description="…" />);
    expect(await screen.findByText('Ready, 2 KB')).toBeTruthy();
    expect(screen.getByText('Failed: the bucket is gone')).toBeTruthy();
    // Each export is a row of a list; only the built one has a Download, and it is named
    // by the export it downloads, since every ready row would otherwise say the same word.
    const rows = within(screen.getByRole('list', { name: 'Exports' })).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    const links = screen.getAllByRole('link', { name: /^Download/ });
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/api/exports/e1/download']);
    expect(links[0]!.getAttribute('aria-label')).toMatch(/^Download the export from /);
    expect(within(rows[1]!).queryByRole('link')).toBeNull();
  });

  it('says there is nothing yet, and for how long one is kept', async () => {
    vi.spyOn(api.me, 'exports').mockResolvedValue({ exports: [] });
    render(<ExportsCard scope="personal" title="Export your data" description="…" />);
    expect(await screen.findByText('Nothing exported yet. An export is kept for a week.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Exports' })).toBeNull();
  });

  it('says whose a workspace export was', async () => {
    vi.spyOn(api.admin, 'exports').mockResolvedValue({ exports: [entry({ scope: 'workspace' })] });
    render(<ExportsCard scope="workspace" title="Export the workspace" description="…" />);
    expect(await screen.findByText('Ready, 2 KB, asked for by Max Member')).toBeTruthy();
  });

  it('asks for one, and waits while it builds', async () => {
    vi.spyOn(api.me, 'exports').mockResolvedValue({ exports: [] });
    const start = vi
      .spyOn(api.me, 'startExport')
      .mockResolvedValue({ exports: [entry({ status: 'pending', downloadUrl: null })] });
    render(<ExportsCard scope="personal" title="Export your data" description="…" />);
    expect(await screen.findByText(/Nothing exported yet/)).toBeTruthy();
    vi.spyOn(api.me, 'exports').mockResolvedValue({
      exports: [entry({ status: 'running', downloadUrl: null })],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(start).toHaveBeenCalled());
    const building = await screen.findByRole('button', { name: 'Building…' });
    // Busy, not gone: it is inert but not natively disabled, so a button that was pressed
    // does not drop its focus to the page while the export builds.
    expect(building.getAttribute('aria-disabled')).toBe('true');
    expect(building.hasAttribute('disabled')).toBe(false);
  });

  it('asks once for a double press', async () => {
    vi.spyOn(api.me, 'exports').mockResolvedValue({ exports: [] });
    const start = vi
      .spyOn(api.me, 'startExport')
      .mockResolvedValue({ exports: [entry({ status: 'pending', downloadUrl: null })] });
    render(<ExportsCard scope="personal" title="Export your data" description="…" />);
    const button = await screen.findByRole('button', { name: 'Export' });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(start).toHaveBeenCalled());
    expect(start).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button);
  });
});
