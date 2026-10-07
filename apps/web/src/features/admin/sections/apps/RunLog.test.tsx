// @vitest-environment happy-dom
/** The console's log of an agent's runs, and opening one to see what it did. */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AdminAgentRun } from '../../../../lib/api.ts';
import { RunLog } from './RunLog.tsx';

afterEach(cleanup);

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

  it('offers nothing to open for a run that left nothing', () => {
    render(<RunLog runs={[logged()]} />);
    expect(document.querySelector('details.run-log-detail')).toBeNull();
    expect(screen.getByText(/model unavailable/)).toBeTruthy();
  });
});
