// @vitest-environment happy-dom
/**
 * Admin → Approvals: what agents wait on, with a room's words, Open and Stop only where the
 * admin can read it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AgentRunView } from '@blob/shared';
import { api, type PendingApproval } from '../../../lib/api.ts';
import { formatMoment } from '../../../lib/format.ts';
import { ApprovalsSection } from './ApprovalsSection.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function run(overrides: Partial<AgentRunView>): AgentRunView {
  return {
    id: 'r1',
    pluginId: 'p1',
    agentName: 'Helper',
    channelId: 'c1',
    threadRootId: null,
    triggerMessageId: 'm1',
    status: 'interrupted',
    error: null,
    postCount: 0,
    startedAt: '2026-10-22T09:00:00.000Z',
    finishedAt: '2026-10-22T09:00:05.000Z',
    card: null,
    chainId: 'm1',
    parentRunId: null,
    depth: 0,
    askedBy: null,
    initiatedByUserId: 'u1',
    answeredAt: null,
    expiresAt: null,
    ...overrides,
  } as AgentRunView;
}

function item(overrides: Partial<PendingApproval> & { run: AgentRunView }): PendingApproval {
  return { channelName: 'general', channelKind: 'public', personName: 'Ana', visible: true, ...overrides };
}

describe('the Approvals page', () => {
  it('shows a question it may read, with Open and Stop', async () => {
    vi.spyOn(api.admin, 'pendingApprovals').mockResolvedValue({
      pending: [
        item({
          run: run({ decision: { prompt: 'Include the risks?' } } as Partial<AgentRunView>),
        }),
      ],
    });
    const cancel = vi.spyOn(api.agentRuns, 'cancel').mockResolvedValue({ ok: true });
    render(<ApprovalsSection />);

    expect(await screen.findByText('Helper, waiting for Ana’s answer')).toBeTruthy();
    expect(screen.getByText('“Include the risks?”')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('r1'));
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy();
  });

  it('keeps a private room’s words in it, and offers nothing to press', async () => {
    vi.spyOn(api.admin, 'pendingApprovals').mockResolvedValue({
      pending: [item({ channelName: 'quiet-room', channelKind: 'private', visible: false, run: run({}) })],
    });
    render(<ApprovalsSection />);

    expect(await screen.findByText(/In #quiet-room/)).toBeTruthy();
    expect(screen.getByText('In a conversation you are not in: what it asks stays there.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull();
  });

  it('says when a follow-up comes back, and what for', async () => {
    const at = '2026-10-24T08:00:00.000Z';
    vi.spyOn(api.admin, 'pendingApprovals').mockResolvedValue({
      pending: [
        item({
          run: run({ status: 'waiting', comesBackAt: at, comesBackFor: 'check the deploy' }),
        }),
      ],
    });
    render(<ApprovalsSection />);

    expect(await screen.findByText(`Helper, coming back ${formatMoment(at)}`)).toBeTruthy();
    expect(screen.getByText('“check the deploy”')).toBeTruthy();
  });

  it('says so when nothing is waiting', async () => {
    vi.spyOn(api.admin, 'pendingApprovals').mockResolvedValue({ pending: [] });
    render(<ApprovalsSection />);
    expect(await screen.findByText('Nothing is waiting on anybody.')).toBeTruthy();
  });
});
