// @vitest-environment happy-dom
/**
 * A conversation's details say how long it keeps things (ADR 0039), and an admin puts it
 * on legal hold, or takes it off, from there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChannelWithState } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { ChannelDetails } from './ChannelDetails.tsx';

const channel = (legalHoldAt: string | null): ChannelWithState =>
  ({
    id: 'c1',
    kind: 'public',
    name: 'general',
    topic: null,
    description: null,
    createdBy: null,
    archivedAt: null,
    lastMessageId: null,
    createdAt: '2026-01-01T00:00:00Z',
    memberIds: null,
    nudgeUnanswered: false,
    posting: 'everyone',
    legalHoldAt,
  }) as unknown as ChannelWithState;

function show(role: 'admin' | 'member', legalHoldAt: string | null = null) {
  useStore.setState({
    users: {},
    currentUser: { id: 'u-me', displayName: 'Me', role, prefs: {} },
    membershipVersion: {},
    retention: { messageDays: 90, fileDays: null, held: false },
  } as never);
  render(<ChannelDetails channel={channel(legalHoldAt)} onClose={vi.fn()} onMembers={vi.fn()} />);
}

beforeEach(() => {
  vi.spyOn(api.channels, 'members').mockResolvedValue({ userIds: [] } as never);
  vi.spyOn(api.admin, 'holdConversation').mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('a conversation’s history', () => {
  it('tells a member the workspace’s rule, and gives them no switch', () => {
    show('member');
    expect(screen.getByText(/removes messages after 90 days, unless the conversation/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Legal hold' })).toBeNull();
  });

  it('lets an admin put it on hold', async () => {
    show('admin');
    const toggle = screen.getByRole('button', { name: 'Legal hold' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    await waitFor(() => expect(api.admin.holdConversation).toHaveBeenCalledWith('c1', true));
  });

  it('says when it is held, and an admin takes it off', async () => {
    show('admin', '2026-10-02T10:00:00Z');
    expect(screen.getByText(/^On legal hold since/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Legal hold' }));
    await waitFor(() => expect(api.admin.holdConversation).toHaveBeenCalledWith('c1', false));
  });
});
