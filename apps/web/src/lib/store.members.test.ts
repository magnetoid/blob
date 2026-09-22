// @vitest-environment happy-dom
/**
 * Who is in a conversation, as the store knows it.
 *
 * Two sources, and they must not be confused. A DM carries its members on the channel
 * itself; a public or private channel sends `memberIds: null` and its list is fetched —
 * by the channel view when it opens, kept here under the membership version it was
 * fetched at, so the `@` list can rank by it before anybody types.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

const { useStore } = await import('./store.ts');

const frame = (t: 'member.joined' | 'member.left', channelId: string, userId: string) =>
  useStore.getState().applyEvent({ t, channelId, userId } as never);

beforeEach(() => {
  useStore.setState({
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', memberIds: null },
      d1: { id: 'd1', kind: 'group_dm', name: null, memberIds: ['me', 'zoe'] },
    },
    membershipVersion: {},
    channelMembers: {},
  } as never);
});

describe('a join or a leave', () => {
  it('leaves a channel’s member list unknown rather than inventing one', () => {
    // `null` is "not sent", not "nobody". Treating it as an empty list turned one join
    // into a channel of one, and one leave into a channel of nobody.
    frame('member.joined', 'c1', 'cleo');
    frame('member.left', 'c1', 'bruno');

    expect(useStore.getState().channels.c1?.memberIds).toBeNull();
    expect(useStore.getState().membershipVersion.c1).toBe(2);
  });

  it('still keeps a DM’s own list truthful', () => {
    frame('member.joined', 'd1', 'ana');
    expect(useStore.getState().channels.d1?.memberIds).toEqual(['me', 'zoe', 'ana']);

    frame('member.left', 'd1', 'zoe');
    expect(useStore.getState().channels.d1?.memberIds).toEqual(['me', 'ana']);
  });
});

describe('a fetched member list', () => {
  it('is kept with the membership version it was fetched at', () => {
    useStore.getState().setChannelMembers('c1', 3, ['me', 'bruno']);
    expect(useStore.getState().channelMembers.c1).toEqual({ version: 3, userIds: ['me', 'bruno'] });
  });

  it('never replaces one fetched after it', () => {
    // Two requests in flight across a join: the older answer can land second.
    useStore.getState().setChannelMembers('c1', 2, ['me', 'bruno', 'cleo']);
    useStore.getState().setChannelMembers('c1', 1, ['me', 'bruno']);

    expect(useStore.getState().channelMembers.c1).toEqual({
      version: 2,
      userIds: ['me', 'bruno', 'cleo'],
    });
  });

  it('is forgotten on sign-out', () => {
    useStore.getState().setChannelMembers('c1', 1, ['me']);
    useStore.getState().reset();
    expect(useStore.getState().channelMembers).toEqual({});
  });
});
