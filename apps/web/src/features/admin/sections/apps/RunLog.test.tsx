// @vitest-environment happy-dom
/** The console's log of an agent's runs, and opening one to see what it did. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    const detail = document.querySelector('details.run-log-detail');
    expect(detail?.querySelector('summary')?.textContent).toBe('What it did');
    expect(screen.getByText('read the thread')).toBeTruthy();
    expect(detail?.querySelector('.agent-run-seen')?.textContent).toBe(
      'Saw 4 messages of this channel',
    );
  });

  it('offers no card to open for a run that left none', () => {
    render(<RunLog pluginId="p1" runs={[logged()]} />);
    const summaries = [...document.querySelectorAll('details.run-log-detail > summary')];
    expect(summaries.map((s) => s.textContent)).toEqual(['What it streamed']);
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

    const detail = document.querySelector('details.run-log-detail') as HTMLDetailsElement;
    detail.open = true;
    fireEvent(detail, new Event('toggle'));

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
    const detail = document.querySelector('details.run-log-detail') as HTMLDetailsElement;
    detail.open = true;
    fireEvent(detail, new Event('toggle'));
    expect(await screen.findByText(/a conversation you are not in/)).toBeTruthy();
  });
});
