/** A thread reply that was also sent to the channel belongs in both lists.
 *
 * The tick above the thread composer stored `also_in_channel` and nothing read it. The
 * server has been fixed to return such a reply in channel history; this is the other
 * half, because the live path never goes near history: `applyEvent` routed anything with
 * a `threadRootId` into the thread and stopped, so the message appeared in the channel
 * only after a reload — which is indistinguishable from the feature not working.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store.ts';

function reply(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    channelId: 'c1',
    authorId: 'them',
    body: id,
    kind: 'user',
    createdAt: '2026-09-03T10:00:00.000Z',
    threadRootId: 'root1',
    alsoInChannel: false,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  // The loaded list has to end at the channel's newest message, or `applyEvent`
  // deliberately drops the arrival: that guard is what stops a live message being
  // appended to a permalink window it does not belong to.
  const root = reply('root1', { id: 'root1', threadRootId: null, body: 'root' });
  useStore.setState({
    currentUser: { id: 'me' },
    // Not the active channel: arriving in the one you are looking at fires `markRead`,
    // which is a real request this test has no business making.
    activeChannelId: null,
    channels: { c1: { id: 'c1', kind: 'public', name: 'general', lastMessageId: 'root1' } },
    messages: { c1: { items: [root], loaded: true, loading: false, hasMore: false } },
    threads: { root1: [] },
    outbox: {},
  } as never);
});

const bodies = (channelId: string) =>
  (useStore.getState().messages[channelId]?.items ?? []).map((m) => m.body);
const threadBodies = (rootId: string) =>
  (useStore.getState().threads[rootId] ?? []).map((m) => m.body);

describe('a thread reply arriving live', () => {
  it('stays in the thread when the box was not ticked', () => {
    useStore.getState().applyEvent({ t: 'message.new', message: reply('quiet') } as never);

    expect(threadBodies('root1')).toEqual(['quiet']);
    expect(bodies('c1')).toEqual(['root']);
  });

  it('lands in the channel as well when it was', () => {
    useStore
      .getState()
      .applyEvent({
        t: 'message.new',
        message: reply('shouted', { alsoInChannel: true }),
      } as never);

    expect(threadBodies('root1')).toEqual(['shouted']);
    expect(bodies('c1')).toEqual(['root', 'shouted']);
  });

  it('is not duplicated in the channel by a later update', () => {
    const message = reply('shouted', { alsoInChannel: true });
    useStore.getState().applyEvent({ t: 'message.new', message } as never);
    useStore
      .getState()
      .applyEvent({ t: 'message.updated', message: { ...message, body: 'edited' } } as never);

    expect(bodies('c1')).toEqual(['root', 'edited']);
    expect(threadBodies('root1')).toEqual(['edited']);
  });

  it('does not stop later channel messages from landing', () => {
    // The pointer question. `channels.lastMessageId` advances for every message the
    // server stores, thread replies included — and the client decides whether a live
    // message may be folded into the list by comparing the last loaded item to that
    // pointer. A plain reply moves the pointer to a message channel history will never
    // return, so if nothing corrected for it the two could never match again and every
    // later message in that channel would be dropped until a reload.
    useStore.getState().applyEvent({ t: 'message.new', message: reply('quiet') } as never);
    useStore.getState().applyEvent({
      t: 'message.new',
      message: reply('after', { id: 'after', threadRootId: null, body: 'after' }),
    } as never);

    expect(bodies('c1')).toContain('after');
  });

  it('still moves the channel on, so the sidebar sees it', () => {
    useStore
      .getState()
      .applyEvent({
        t: 'message.new',
        message: reply('shouted', { alsoInChannel: true }),
      } as never);

    expect(useStore.getState().channels.c1?.lastMessageId).toBe('shouted');
  });
});
