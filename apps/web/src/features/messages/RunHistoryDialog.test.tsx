// @vitest-environment happy-dom
/** An agent's runs, paged back: what the history dialog asks for and shows. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AgentRunView } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { RunHistoryDialog } from './RunHistoryDialog.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function run(id: string, overrides: Partial<AgentRunView> = {}): AgentRunView {
  return {
    id,
    pluginId: 'p1',
    agentName: 'Janus',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: `m-${id}`,
    status: 'succeeded',
    error: null,
    postCount: 1,
    startedAt: '2026-10-07T10:00:00.000Z',
    finishedAt: '2026-10-07T10:00:05.000Z',
    card: null,
    chainId: `m-${id}`,
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: 'u1',
    answeredAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe('the run history', () => {
  it('shows a page of runs, newest first, and asks for the older ones from the last', async () => {
    useStore.setState({
      channels: { c1: { id: 'c1', kind: 'public', name: 'general', membership: {} } },
      agentRuns: {},
    } as never);
    const history = vi
      .spyOn(api.agentRuns, 'history')
      .mockResolvedValueOnce({ runs: [run('r3'), run('r2')], nextBefore: 'r2' })
      .mockResolvedValueOnce({ runs: [run('r1', { status: 'failed', error: 'boom' })], nextBefore: null });

    render(
      <RunHistoryDialog
        scope={{ channelId: 'c1' }}
        title="Agent runs in #general"
        onClose={() => {}}
      />,
    );

    await screen.findAllByText(/Janus/);
    expect(history).toHaveBeenCalledWith({ channelId: 'c1', limit: 20 });
    expect(document.querySelectorAll('.run-history-list > li')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Older runs' }));
    await screen.findByText(/failed — boom/);
    expect(history).toHaveBeenLastCalledWith({ channelId: 'c1', before: 'r2', limit: 20 });
    expect(document.querySelectorAll('.run-history-list > li')).toHaveLength(3);
    // The oldest page says so: nothing more to ask for.
    expect(screen.queryByRole('button', { name: 'Older runs' })).toBeNull();
  });

  it('says where each run was when it is one agent everywhere', async () => {
    useStore.setState({
      channels: { c1: { id: 'c1', kind: 'public', name: 'general', membership: {} } },
      channelTitle: (channel: { name: string | null }) => `#${channel.name}`,
      agentRuns: {},
    } as never);
    vi.spyOn(api.agentRuns, 'history').mockResolvedValue({ runs: [run('r1')], nextBefore: null });

    render(
      <RunHistoryDialog
        scope={{ agentUserId: 'b1' }}
        title="What Janus has done"
        onClose={() => {}}
      />,
    );

    expect((await screen.findByText(/#general/)).textContent).toContain('#general');
  });

  it('says so when nothing has run', async () => {
    vi.spyOn(api.agentRuns, 'history').mockResolvedValue({ runs: [], nextBefore: null });
    render(<RunHistoryDialog scope={{ channelId: 'c1' }} title="Agent runs" onClose={() => {}} />);
    expect(await screen.findByText(/No agent has been asked anything here yet/)).toBeTruthy();
  });
});
