// @vitest-environment happy-dom
/**
 * Admin → Import (ADR 0042): choose the zip, see what it holds, choose what comes, watch it
 * run, invite the people it brought.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { api, type ImportRecord, type ImportState } from '../../../lib/api.ts';
import { useToasts } from '../../../lib/toasts.ts';

// The zip goes to storage by an XHR; here it is a promise the test settles, reporting how
// far it has got when told to.
const upload: { onProgress: (sent: number) => void; finish: () => void } = {
  onProgress: () => undefined,
  finish: () => undefined,
};
vi.mock('../../../lib/putFile.ts', () => ({
  putFile: (_url: string, _file: Blob, _type: string, onProgress: (sent: number) => void) =>
    new Promise<void>((resolve) => {
      upload.onProgress = onProgress;
      upload.finish = resolve;
    }),
}));

const { ImportSection } = await import('./ImportSection.tsx');

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
    // The two steps are a numbered list, and the limit is said beside the button.
    const steps = screen.getByRole('list');
    expect(within(steps).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Up to 2.0 GB.')).toBeTruthy();
  });

  it('shows the upload moving, then hands the zip over to be read', async () => {
    const importState = vi.spyOn(api.admin, 'importState').mockResolvedValue(state(null));
    vi.spyOn(api.admin, 'createImport').mockResolvedValue({
      uploadUrl: 'https://storage.example/zip',
      current: record({ status: 'uploading', preview: null }),
    } as never);
    const uploaded = vi.spyOn(api.admin, 'importUploaded').mockResolvedValue(state(null));
    render(<ImportSection />);
    const input = (await screen.findByLabelText('Slack export zip')) as HTMLInputElement;
    const zip = new File([new Uint8Array(1000)], 'export.zip', { type: 'application/zip' });
    fireEvent.change(input, { target: { files: [zip] } });

    expect(await screen.findByRole('heading', { name: 'Uploading' })).toBeTruthy();
    expect(screen.getByText('export.zip')).toBeTruthy();
    const bar = await screen.findByRole('progressbar', { name: 'Uploaded' });
    expect(bar.getAttribute('aria-valuenow')).toBe('0');

    await waitFor(() => expect(upload.finish).not.toBe(undefined));
    upload.onProgress(250);
    await waitFor(() => expect(bar.getAttribute('aria-valuenow')).toBe('250'));
    expect(bar.getAttribute('aria-valuemax')).toBe('1000');
    expect(screen.getByText('250 B of 1000 B')).toBeTruthy();

    upload.finish();
    await waitFor(() => expect(uploaded).toHaveBeenCalledWith('i1'));
    // And the page looks again, to read what the worker made of it.
    await waitFor(() => expect(importState.mock.calls.length).toBeGreaterThan(1));
  });

  it('refuses a zip larger than the server takes, before sending any of it', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue({
      ...state(null),
      maxBytes: 100,
    });
    const create = vi.spyOn(api.admin, 'createImport');
    render(<ImportSection />);
    const input = (await screen.findByLabelText('Slack export zip')) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array(500)], 'big.zip', { type: 'application/zip' })] },
    });
    await waitFor(() =>
      expect(useToasts.getState().toasts.some((t) => /larger than the 100 B/.test(t.text))).toBe(true),
    );
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says what the zip holds, and starts with private conversations left out', async () => {
    vi.spyOn(api.admin, 'importState').mockResolvedValue(state(record({})));
    const start = vi.spyOn(api.admin, 'startImport').mockResolvedValue(state(record({ status: 'running' })));
    render(<ImportSection />);

    expect(await screen.findByText(/12 channels, 900 days of history/)).toBeTruthy();
    expect(screen.getByText(/Merging into channels already here: #general, #random/)).toBeTruthy();
    expect(screen.getByText(/4 already here, 21 arriving as names on their messages/)).toBeTruthy();
    // Each choice is a checkbox named by its label, with what it means tied to it.
    expect(
      screen.getByRole('checkbox', {
        name: 'Also bring private channels and direct messages',
        checked: false,
        description: /Only the people who were in each one will see it/,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', {
        name: 'Copy files',
        checked: true,
        description: /A file that isn’t copied leaves a line in its message saying so/,
      }),
    ).toBeTruthy();

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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Copy files' }));
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
    const bar = screen.getByRole('progressbar', { name: 'Conversations imported' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('12');
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
    // What did not come over is behind a disclosure, and says what each thing was.
    const problems = screen.getByText('1 thing didn’t come over').closest('details')!;
    expect(problems.open).toBe(false);
    expect(within(problems).getByText('report.pdf in #general could not be fetched from Slack.')).toBeTruthy();
    expect(screen.getByText(/revoke them on Slack’s export page/)).toBeTruthy();
    // Still offered a new one.
    expect(screen.getByRole('heading', { name: 'Import another export' })).toBeTruthy();

    const button = await screen.findByRole('button', { name: 'Invite 1 person' });
    // Everybody not invited yet is chosen; Bob already was, and the row says so.
    expect(
      screen.getByRole('checkbox', { name: 'Pat Lee', checked: true, description: 'pat@example.com' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('checkbox', { name: 'Bob', checked: false, description: 'bob@example.com, invited' }),
    ).toBeTruthy();
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
    // And the way to try again is offered below it.
    expect(screen.getByRole('heading', { name: 'Import another export' })).toBeTruthy();
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
