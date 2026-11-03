// @vitest-environment happy-dom
/**
 * The server's Logs page: the most recent warnings and errors from every process, newest
 * first. Pinned: the level is the filter and is read back from what is pressed; a traceback
 * opens under its entry and one at a time, in a box that scrolls inside itself; the buffer is
 * cleared only after a question; and a failed read says nothing rather than "all quiet".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type ServerLogEntry } from '../../../lib/api.ts';
import { LogsSection } from './LogsSection.tsx';
import '../../../test/overlayChunk.ts';

const entry = (patch: Partial<ServerLogEntry>): ServerLogEntry => ({
  at: '2026-10-28T10:00:00.000Z',
  level: 'ERROR',
  logger: 'blob.worker',
  message: 'Queue is backing up',
  detail: null,
  path: null,
  method: null,
  ...patch,
});

const ENTRIES = [
  entry({
    at: '2026-10-28T10:05:00.000Z',
    message: 'Unhandled error',
    detail: 'Traceback (most recent call last):\n  File "x.py", line 1',
    path: '/api/messages',
    method: 'POST',
  }),
  entry({
    at: '2026-10-28T10:04:00.000Z',
    level: 'WARNING',
    logger: 'blob.mail',
    message: 'SMTP slow',
    detail: 'slow at line 9',
  }),
  entry({ at: '2026-10-28T10:03:00.000Z', level: 'WARNING', message: 'No detail here' }),
];

beforeEach(() => {
  vi.spyOn(api.admin, 'serverLogs').mockResolvedValue({ capacity: 500, entries: ENTRIES });
  vi.spyOn(api.admin, 'clearServerLogs').mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the log', () => {
  it('lists each record with its level, time, logger and route', async () => {
    render(<LogsSection onError={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Recent warnings and errors' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);

    const first = rows[0]!;
    expect(within(first).getByText('ERROR')).toBeTruthy();
    expect(within(first).getByText('Unhandled error')).toBeTruthy();
    expect(within(first).getByText('blob.worker')).toBeTruthy();
    expect(within(first).getByText('POST /api/messages')).toBeTruthy();
    expect(first.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-28T10:05:00.000Z');
    // The level is what is scanned for, so each row carries it for the stripe down its edge.
    expect(first.getAttribute('data-level')).toBe('error');
    expect(rows[1]!.getAttribute('data-level')).toBe('warning');
    expect(screen.getByText(/The most recent 500 warnings and errors/)).toBeTruthy();
  });

  it('filters by level, and reads the filter back from what is pressed', async () => {
    render(<LogsSection onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Recent warnings and errors' });
    const filter = screen.getByRole('group', { name: 'Show' });
    expect(within(filter).getByRole('button', { name: 'Everything', pressed: true })).toBeTruthy();

    fireEvent.click(within(filter).getByRole('button', { name: 'Errors' }));
    await waitFor(() => expect(api.admin.serverLogs).toHaveBeenLastCalledWith({ level: 'error' }));
    expect(within(filter).getByRole('button', { name: 'Errors', pressed: true })).toBeTruthy();
    expect(within(filter).getByRole('button', { name: 'Everything', pressed: false })).toBeTruthy();

    // The one that is chosen stays chosen: pressing it again would leave no filter at all.
    fireEvent.click(within(filter).getByRole('button', { name: 'Errors' }));
    expect(within(filter).getByRole('button', { name: 'Errors', pressed: true })).toBeTruthy();

    fireEvent.click(within(filter).getByRole('button', { name: 'Everything' }));
    await waitFor(() => expect(api.admin.serverLogs).toHaveBeenLastCalledWith({ level: undefined }));
  });

  it('asks again on Refresh', async () => {
    render(<LogsSection onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Recent warnings and errors' });
    const calls = vi.mocked(api.admin.serverLogs).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(vi.mocked(api.admin.serverLogs).mock.calls.length).toBe(calls + 1));
  });

  it('says nothing has gone wrong, and to widen the filter when one is on', async () => {
    vi.spyOn(api.admin, 'serverLogs').mockResolvedValue({ capacity: 500, entries: [] });
    render(<LogsSection onError={vi.fn()} />);
    expect(await screen.findByText(/Nothing has gone wrong recently\./)).toBeTruthy();
    expect(screen.queryByText(/Try widening the filter/)).toBeNull();
    // Nothing to clear.
    expect(screen.getByRole('button', { name: 'Clear' }).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Warnings' }));
    expect(await screen.findByText(/Try widening the filter\./)).toBeTruthy();
  });

  it('says nothing about a log it failed to read, rather than that all is quiet', async () => {
    vi.spyOn(api.admin, 'serverLogs').mockRejectedValue(new Error('boom'));
    const onError = vi.fn();
    render(<LogsSection onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Could not read the log.'));
    expect(screen.queryByText(/Nothing has gone wrong recently/)).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });
});

describe('a traceback', () => {
  it('opens under its entry, one at a time, behind a button that keeps its name', async () => {
    render(<LogsSection onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Recent warnings and errors' });
    // An entry with no traceback has no button.
    expect(screen.getAllByRole('button', { name: /^Traceback/ })).toHaveLength(2);

    const first = screen.getByRole('button', { name: 'Traceback Unhandled error' });
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(first.getAttribute('aria-controls')).toBeNull();
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(first.getAttribute('aria-controls')!)!;
    expect(panel.textContent).toContain('Traceback (most recent call last):');
    // Monospace, and bounded: a long traceback scrolls inside its own box rather than
    // stretching the page (happy-dom has no layout, so the classes are what is pinned).
    expect(panel.className).toContain('font-mono');
    expect(panel.className).toContain('max-h-');
    expect(panel.className).toContain('overflow-auto');

    const second = screen.getByRole('button', { name: 'Traceback SMTP slow' });
    fireEvent.click(second);
    expect(second.getAttribute('aria-expanded')).toBe('true');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Traceback \(most recent call last\)/)).toBeNull();

    fireEvent.click(second);
    expect(second.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('clearing the log', () => {
  it('asks first, and clears on the answer', async () => {
    render(<LogsSection onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Recent warnings and errors' });
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(api.admin.clearServerLogs).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear the log?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(api.admin.clearServerLogs).toHaveBeenCalledTimes(1));
  });

  it('closes only the question on Escape, and gives focus back to Clear', async () => {
    render(<LogsSection onError={vi.fn()} />);
    await screen.findByRole('list', { name: 'Recent warnings and errors' });
    const clear = screen.getByRole('button', { name: 'Clear' });
    clear.focus();
    fireEvent.click(clear);
    const dialog = await screen.findByRole('alertdialog', { name: 'Clear the log?' });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(clear);
    expect(api.admin.clearServerLogs).not.toHaveBeenCalled();
    expect(screen.getByRole('list', { name: 'Recent warnings and errors' })).toBeTruthy();
  });
});
