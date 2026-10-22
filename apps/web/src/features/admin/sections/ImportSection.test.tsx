// @vitest-environment happy-dom
/**
 * Admin → Import (ADR 0042): choose the zip, see what it holds, choose what comes, watch it
 * run, invite the people it brought.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api, type ImportRecord, type ImportState } from '../../../lib/api.ts';
import { ImportSection } from './ImportSection.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function record(overrides: Partial<ImportRecord>): ImportRecord {
  return {
    id: 'i1',
    status: 'ready',
    bytes: 1000,
    includePrivate: false,
    copyFiles: true,
    preview: {
      publicChannels: 12,
      privateChannels: 3,
      directMessages: 40,
      groupMessages: 2,
      publicDays: 900,
      privateDays: 300,
      people: 25,
      matched: 4,
      placeholders: 21,
      withoutAddress: 1,
      apps: 2,
      merging: ['general', 'random'],
    },
    progress: {
      conversations: 0,
      conversationsTotal: 0,
      messages: 0,
      filesCopied: 0,
      filesSkipped: 0,
      peopleCreated: 0,
      peopleMatched: 0,
    },
    problems: [],
    error: null,
    createdAt: '2026-10-22T09:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    requestedByName: 'Olga',
    ...overrides,
  };
}

function state(current: ImportRecord | null): ImportState {
  return { current, maxBytes: 2 * 1024 ** 3, maxFileBytes: 25 * 1024 ** 2 };
}

describe('importing from Slack', () => {
  it('starts with how to get the zip, and the button that takes it', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(state(null));
    render(<ImportSection />);
    expect(await screen.findByRole('heading', { name: 'Import from Slack' })).toBeTruthy();
    expect(screen.getByText(/Import\/Export Data/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose the zip' })).toBeTruthy();
    expect(screen.getByLabelText('Slack export zip')).toBeTruthy();
  });

  it('says what the zip holds, and starts with private conversations left out', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(state(record({})));
    const start = vi.spyOn(api.admin, 'startImport').mockResolvedValue(state(record({ status: 'running' })));
    render(<ImportSection />);

    expect(await screen.findByText(/12 channels, 900 days of history/)).toBeTruthy();
    expect(screen.getByText(/Merging into channels already here: #general, #random/)).toBeTruthy();
    expect(screen.getByText(/4 already here, 21 arriving as names on their messages/)).toBeTruthy();
    const privately = screen.getByRole('checkbox', {
      name: /Also bring private channels and direct messages/,
    }) as HTMLInputElement;
    expect(privately.checked).toBe(false);
    expect((screen.getByRole('checkbox', { name: /Copy files/ }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Start import' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith('i1', { includePrivate: false, copyFiles: true }),
    );
  });

  it('brings private conversations only when the box is ticked', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(state(record({})));
    const start = vi.spyOn(api.admin, 'startImport').mockResolvedValue(state(record({ status: 'running' })));
    render(<ImportSection />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Also bring private channels/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Copy files/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start import' }));
    await waitFor(() =>
      expect(start).toHaveBeenCalledWith('i1', { includePrivate: true, copyFiles: false }),
    );
  });

  it('shows a running import moving, and stops it when asked', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(
      state(
        record({
          status: 'running',
          progress: {
            conversations: 3,
            conversationsTotal: 12,
            messages: 4210,
            filesCopied: 17,
            filesSkipped: 2,
            peopleCreated: 21,
            peopleMatched: 4,
          },
        }),
      ),
    );
    const cancel = vi.spyOn(api.admin, 'cancelImport').mockResolvedValue(state(null));
    render(<ImportSection />);
    expect(await screen.findByText(/3 of 12 conversations, 4,210 messages, 17 files copied/)).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Conversations imported' }) as HTMLProgressElement;
    expect(bar.value).toBeCloseTo(0.25);
    fireEvent.click(screen.getByRole('button', { name: 'Stop import' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('i1'));
  });

  it('afterwards, invites the people who came over who are not invited yet', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(
      state(
        record({
          status: 'done',
          finishedAt: '2026-10-22T10:00:00.000Z',
          progress: {
            conversations: 12,
            conversationsTotal: 12,
            messages: 50000,
            filesCopied: 80,
            filesSkipped: 3,
            peopleCreated: 21,
            peopleMatched: 4,
          },
          problems: ['report.pdf in #general could not be fetched from Slack.'],
        }),
      ),
    );
    vi.spyOn(api.admin, 'importPeople').mockResolvedValue({
      people: [
        { userId: 'u1', name: 'Pat Lee', email: 'pat@example.com', invited: false },
        { userId: 'u2', name: 'Bob', email: 'bob@example.com', invited: true },
      ],
    });
    const invite = vi.spyOn(api.admin, 'inviteImported').mockResolvedValue({ invited: 1 });
    render(<ImportSection />);

    expect(await screen.findByText(/50,000 messages in 12 conversations, 80 files copied/)).toBeTruthy();
    expect(screen.getByText('1 thing didn’t come over')).toBeTruthy();
    expect(screen.getByText(/revoke them on Slack’s export page/)).toBeTruthy();
    // Still offered a new one.
    expect(screen.getByRole('heading', { name: 'Import another export' })).toBeTruthy();

    const button = await screen.findByRole('button', { name: 'Invite 1 person' });
    expect((screen.getByRole('checkbox', { name: /Bob/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(invite).toHaveBeenCalledWith('i1', ['u1']));
  });

  it('says so when a second run of the same export found nothing new', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(
      state(
        record({
          status: 'done',
          finishedAt: '2026-10-22T10:00:00.000Z',
          progress: {
            conversations: 5,
            conversationsTotal: 5,
            messages: 0,
            filesCopied: 0,
            filesSkipped: 0,
            peopleCreated: 0,
            peopleMatched: 6,
          },
        }),
      ),
    );
    vi.spyOn(api.admin, 'importPeople').mockResolvedValue({ people: [] });
    render(<ImportSection />);
    expect(await screen.findByText('Everything in this export was already here.')).toBeTruthy();
  });

  it('says why the last one failed', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(
      state(record({ status: 'failed', error: 'That file is not a zip.', preview: null })),
    );
    render(<ImportSection />);
    expect(await screen.findByText('That file is not a zip.')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'The last import didn’t finish' })).toBeTruthy();
  });

  it('looks again while the worker has it', async () => {
    const look = vi
      .spyOn(api.admin, 'importState')
      .mockResolvedValueOnce(state(record({ status: 'reading', preview: null })))
      .mockResolvedValue(state(record({})));
    render(<ImportSection />);
    expect(await screen.findByRole('heading', { name: 'Reading the export' })).toBeTruthy();
    expect(await screen.findByText(/12 channels/, {}, { timeout: 4000 })).toBeTruthy();
    expect(look).toHaveBeenCalledTimes(2);
  });
});
