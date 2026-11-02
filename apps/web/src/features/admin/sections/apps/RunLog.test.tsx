// @vitest-environment happy-dom
/** The console's log of an agent's runs, and opening one to see what it did.
 *
 * A run is a row: where it ran and how it ended, who asked and when. What it did and what
 * it streamed are two disclosures on that row, each named after the run it belongs to and
 * saying whether it is open; what it streamed is not fetched until somebody opens it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { api, type AdminAgentRun } from '../../../../lib/api.ts';
import { RunLog } from './RunLog.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function logged(overrides: Partial<AdminAgentRun> = {}): AdminAgentRun {
  return {
    id: 'r1',
    channelId: 'c1',
    channelName: 'general',
    threadRootId: null,
    triggerMessageId: 'm1',
    triggerUserName: 'Ana',
    transport: 'http',
    status: 'failed',
    error: 'model unavailable',
    postCount: 0,
    startedAt: '2026-10-07T10:00:00.000Z',
    finishedAt: '2026-10-07T10:00:03.000Z',
    durationMs: 3000,
    depth: 0,
    askedBy: null,
    tokens: null,
    card: null,
    seen: null,
    ...overrides,
  };
}

describe('the run log', () => {
  it('is a row for each run: where it ran, how it ended, who asked and when', () => {
    render(<RunLog pluginId="p1" runs={[logged(), logged({ id: 'r2', channelName: 'launch', status: 'succeeded', error: null, postCount: 1 })]} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('#general')).toBeTruthy();
    expect(within(rows[0]!).getByText('failed')).toBeTruthy();
    expect(within(rows[0]!).getByText(/^Ana asked · .* · 3000 ms · 0 replies · model unavailable$/)).toBeTruthy();
    expect(within(rows[1]!).getByText('succeeded')).toBeTruthy();
    expect(within(rows[1]!).getByText(/ · 1 reply$/)).toBeTruthy();
  });

  it('says there is nothing yet, in the words it was given', () => {
    render(<RunLog pluginId="p1" runs={[]} emptyLabel="Janus has not been asked anything yet." />);
    expect(screen.getByText('Janus has not been asked anything yet.')).toBeTruthy();
    expect(screen.queryByRole('listitem')).toBeNull();
  });

  it('opens a run onto what it did and what it was shown', () => {
    render(
      <RunLog
        pluginId="p1"
        runs={[
          logged({
            card: {
              steps: [{ name: 'read the thread', status: 'done' }],
              tools: [],
              activity: null,
              reasoning: null,
              textChars: 0,
              dropped: 0,
            },
            seen: {
              messages: 4,
              window: 'channel',
              files: 0,
              instructions: false,
              memory: false,
              task: false,
              tools: [],
              protocol: null,
            },
          }),
        ]}
      />,
    );
    // Named after the run it is for, and closed until pressed.
    const toggle = screen.getByRole('button', { name: 'What it did #general' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('read the thread')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBeTruthy();
    expect(screen.getByText('read the thread')).toBeTruthy();
    expect(screen.getByText('Saw 4 messages of this channel')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBeNull();
    expect(screen.queryByText('read the thread')).toBeNull();
  });

  it('offers no card to open for a run that left none', () => {
    render(<RunLog pluginId="p1" runs={[logged()]} />);
    expect(screen.queryByRole('button', { name: /What it did/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'What it streamed #general' })).toBeTruthy();
    expect(screen.getByText(/model unavailable/)).toBeTruthy();
  });

  it('reads what a run streamed only once it is opened', async () => {
    const read = vi.spyOn(api.admin, 'runEvents').mockResolvedValue({
      hidden: false,
      total: 230,
      events: [
        { ms: 4, round: 0, event: { type: 'RUN_STARTED', runId: 'r' } },
        { ms: 950, round: 1, event: { type: 'RUN_ERROR', message: 'model unavailable' } },
      ],
      keptUntil: '2026-10-14T10:00:00.000Z',
    });
    render(<RunLog pluginId="p1" runs={[logged()]} />);
    expect(read).not.toHaveBeenCalled();

    const toggle = screen.getByRole('button', { name: 'What it streamed #general' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    expect(await screen.findByText('RUN_ERROR')).toBeTruthy();
    expect(read).toHaveBeenCalledWith('p1', 'r1');
    expect(screen.getByText(/The last 2 of 230 events/)).toBeTruthy();
    // Rounds are numbered only for a run that had more than one.
    expect(screen.getByText('+950 ms · round 2')).toBeTruthy();
    expect(screen.getByText('{"message":"model unavailable"}')).toBeTruthy();
  });

  it('says so when the run was in a room you are not in', async () => {
    vi.spyOn(api.admin, 'runEvents').mockResolvedValue({
      hidden: true,
      total: 0,
      events: [],
      keptUntil: '2026-10-14T10:00:00.000Z',
    });
    render(<RunLog pluginId="p1" runs={[logged()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'What it streamed #general' }));
    expect(await screen.findByText(/a conversation you are not in/)).toBeTruthy();
  });

  it('says so when its events cannot be read, and when none are kept', async () => {
    const read = vi.spyOn(api.admin, 'runEvents').mockRejectedValueOnce(new Error('nope'));
    render(<RunLog pluginId="p1" runs={[logged()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'What it streamed #general' }));
    expect(await screen.findByText('Its events could not be read.')).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);

    cleanup();
    vi.spyOn(api.admin, 'runEvents').mockResolvedValue({
      hidden: false,
      total: 0,
      events: [],
      keptUntil: '2026-10-14T10:00:00.000Z',
    });
    render(<RunLog pluginId="p1" runs={[logged()]} />);
    fireEvent.click(screen.getByRole('button', { name: 'What it streamed #general' }));
    expect(await screen.findByText(/Nothing is kept for this run/)).toBeTruthy();
  });
});
