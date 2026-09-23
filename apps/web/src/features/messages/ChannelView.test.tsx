// @vitest-environment happy-dom
/** R45: the Meetup button used to be offered in an archived channel, where `start`
 * refuses it (`require_writable`) and the person got an error toast for their trouble —
 * the composer right below it is already hidden there. Gated the same way here, except
 * a meetup already live in the channel stays reachable: joining one still works in an
 * archived channel, only starting a new one does not.
 *
 * Every heavy neighbour — the message list, the composer, the catch-up strip, the typing
 * line, and the work behind a channel — is stubbed out: what is under test is only
 * whether `ChannelView` offers the control at all, not what any of them render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('./MessageList.tsx', () => ({ MessageList: () => null }));
vi.mock('./Composer.tsx', () => ({ Composer: () => null }));
vi.mock('./CatchUpStrip.tsx', () => ({ CatchUpStrip: () => null }));
vi.mock('./TypingIndicator.tsx', () => ({ TypingIndicator: () => null }));
vi.mock('../work/useWork.ts', () => ({ useWork: () => ({ work: null, artifacts: [] }) }));
// Never resolves: nothing here asserts on the membership fetch, and letting it hang
// keeps the effect from landing a state update outside of any test's own act().
vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: { ...actual.api, channels: { ...actual.api.channels, members: () => new Promise(() => {}) } },
  };
});

const { useStore } = await import('../../lib/store.ts');
const { ChannelView } = await import('./ChannelView.tsx');

function channel(over: Record<string, unknown> = {}) {
  return {
    id: 'ch-1',
    name: 'design',
    kind: 'public',
    archivedAt: null,
    topic: null,
    hasUnread: false,
    mentionCount: 0,
    ...over,
  };
}

const call = (over: Record<string, unknown> = {}) => ({
  id: 'call-1',
  channelId: 'ch-1',
  kind: 'meetup' as const,
  createdBy: 'u1',
  status: 'active' as const,
  createdAt: '2026-09-22T10:00:00.000Z',
  endedAt: null,
  participantIds: [],
  ...over,
});

afterEach(cleanup);
beforeEach(() => {
  useStore.setState({
    activeChannelId: 'ch-1',
    channels: { 'ch-1': channel() } as never,
    messages: {},
    outbox: {},
    typing: {},
    users: {},
    currentUser: { id: 'me' } as never,
    status: 'online',
    unreadMarkers: {},
    agentRuns: {},
    channelMembers: {},
    membershipVersion: {},
    activeCalls: {},
    callsAvailable: true,
    callSettings: {
      huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
      meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 50 },
    },
  });
});

function meetupButton() {
  return screen.queryByRole('button', { name: /meetup/i });
}

describe('the Meetup button in an archived channel (R45)', () => {
  it('is offered in an ordinary channel, same as always', () => {
    render(<ChannelView />);
    expect(meetupButton()).not.toBeNull();
  });

  it('is withheld in an archived channel with no call already live there', () => {
    useStore.setState({
      channels: { 'ch-1': channel({ archivedAt: '2026-09-20T00:00:00.000Z' }) } as never,
    });
    render(<ChannelView />);
    expect(meetupButton()).toBeNull();
  });

  it('stays offered in an archived channel once a meetup is already live there — joining still works', () => {
    useStore.setState({
      channels: { 'ch-1': channel({ archivedAt: '2026-09-20T00:00:00.000Z' }) } as never,
      activeCalls: { 'call-1': call() } as never,
    });
    render(<ChannelView />);
    expect(meetupButton()).not.toBeNull();
  });

  it('stays withheld in an archived channel when the live call there is a huddle, not a meetup', () => {
    useStore.setState({
      channels: { 'ch-1': channel({ archivedAt: '2026-09-20T00:00:00.000Z' }) } as never,
      activeCalls: { 'call-1': call({ kind: 'huddle' }) } as never,
    });
    render(<ChannelView />);
    expect(meetupButton()).toBeNull();
  });
});
