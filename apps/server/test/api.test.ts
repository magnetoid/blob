/**
 * Integration tests against a real Postgres and Redis.
 *
 * These cover the behaviours that would be invisible to unit tests: idempotent
 * inserts, the unread cursor, and the permission join that keeps private channels
 * out of other people's search results.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChannelWithState, Message } from '@blob/shared';
import { forgetOwner, getApp, resetDatabase, sendMessage, signUp, type TestClient } from './helpers.ts';
import { closePool } from '../src/db/pool.ts';
import { closeRedis } from '../src/lib/redis.ts';
import { closeQueue } from '../src/lib/queue.ts';

let owner: TestClient;
let member: TestClient;
let outsider: TestClient;
let general: ChannelWithState;

beforeAll(async () => {
  await resetDatabase();
  forgetOwner();
  await getApp();

  owner = await signUp('Owner');
  member = await signUp('Member');
  outsider = await signUp('Outsider');

  const res = await owner.request<{ channels: ChannelWithState[] }>('GET', '/api/channels');
  const found = res.body.channels.find((c) => c.name === 'general');
  if (!found) throw new Error('default #general channel was not created');
  general = found;
});

afterAll(async () => {
  await Promise.allSettled([closeQueue(), closeRedis(), closePool()]);
});

describe('signup and bootstrap', () => {
  it('makes the first user the workspace owner and everyone else a member', async () => {
    const boot = await owner.request<{ user: { role: string }; users: unknown[] }>(
      'GET',
      '/api/bootstrap',
    );
    expect(boot.status).toBe(200);
    expect(boot.body.user.role).toBe('owner');
    expect(boot.body.users.length).toBe(3);
  });

  it('refuses requests without a session', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/api/bootstrap' });
    expect(res.statusCode).toBe(401);
  });

  it('auto-joins new users to the default channels', async () => {
    const res = await member.request<{ channels: ChannelWithState[] }>('GET', '/api/channels');
    const joined = res.body.channels.filter((c) => c.membership !== null).map((c) => c.name);
    expect(joined).toEqual(expect.arrayContaining(['general', 'random']));
  });
});

describe('sending messages', () => {
  it('stores a message and returns it', async () => {
    const res = await sendMessage(owner, general.id, 'first post');
    expect(res.status).toBe(201);
    expect(res.body.message.body).toBe('first post');
  });

  it('is idempotent for a repeated clientMsgId', async () => {
    const clientMsgId = 'retry-me-0001';
    const first = await owner.request<{ message: Message }>(
      'POST',
      `/api/channels/${general.id}/messages`,
      { body: 'sent once', clientMsgId },
    );
    const second = await owner.request<{ message: Message }>(
      'POST',
      `/api/channels/${general.id}/messages`,
      { body: 'sent once', clientMsgId },
    );

    expect(first.status).toBe(201);
    expect(second.status).toBe(200); // 200, not 201 — nothing new was created
    expect(second.body.message.id).toBe(first.body.message.id);
  });

  it('rejects an empty message', async () => {
    const res = await owner.request('POST', `/api/channels/${general.id}/messages`, {
      body: '   ',
      clientMsgId: 'empty-1',
    });
    expect(res.status).toBe(400);
  });

  it('resolves mentions at write time', async () => {
    const res = await sendMessage(owner, general.id, `hey @${member.displayName} look at this`);
    expect(res.status).toBe(201);
    const message = (res.body as { message: Message }).message;
    expect(message.mentionUserIds).toContain(member.userId);
  });

  it('returns history newest-last with keyset pagination', async () => {
    const res = await owner.request<{ messages: Message[]; hasMore: boolean }>(
      'GET',
      `/api/channels/${general.id}/messages?limit=2`,
    );
    expect(res.body.messages.length).toBeLessThanOrEqual(2);
    // Ascending order: the client renders straight down the page.
    const ids = res.body.messages.map((m) => m.id);
    expect([...ids].sort()).toEqual(ids);
  });
});

describe('threads', () => {
  it('tracks reply count and participants on the root', async () => {
    const root = await sendMessage(owner, general.id, 'thread root');
    const rootId = (root.body as { message: Message }).message.id;

    await sendMessage(member, general.id, 'first reply', { threadRootId: rootId });
    await sendMessage(member, general.id, 'second reply', { threadRootId: rootId });

    const thread = await owner.request<{ messages: Message[] }>(
      'GET',
      `/api/messages/${rootId}/thread`,
    );
    expect(thread.body.messages).toHaveLength(3); // root + 2 replies

    const updatedRoot = thread.body.messages[0] as Message;
    expect(updatedRoot.replyCount).toBe(2);
    expect(updatedRoot.replyUserIds).toContain(member.userId);
  });

  it('keeps thread replies out of the main channel timeline', async () => {
    const before = await owner.request<{ messages: Message[] }>(
      'GET',
      `/api/channels/${general.id}/messages?limit=100`,
    );
    const root = await sendMessage(owner, general.id, 'another root');
    const rootId = (root.body as { message: Message }).message.id;
    await sendMessage(owner, general.id, 'hidden reply', { threadRootId: rootId });

    const after = await owner.request<{ messages: Message[] }>(
      'GET',
      `/api/channels/${general.id}/messages?limit=100`,
    );
    // Only the root joined the timeline; the reply lives in the thread.
    expect(after.body.messages.length).toBe(before.body.messages.length + 1);
  });
});

describe('reactions', () => {
  it('adds and removes a reaction, and ignores duplicates', async () => {
    const sent = await sendMessage(owner, general.id, 'react to me');
    const messageId = (sent.body as { message: Message }).message.id;

    expect((await owner.request('PUT', `/api/messages/${messageId}/reactions`, { emoji: ':tada:' })).status).toBe(200);
    await member.request('PUT', `/api/messages/${messageId}/reactions`, { emoji: ':tada:' });
    await member.request('PUT', `/api/messages/${messageId}/reactions`, { emoji: ':tada:' });

    const thread = await owner.request<{ messages: Message[] }>(
      'GET',
      `/api/messages/${messageId}/thread`,
    );
    const reaction = (thread.body.messages[0] as Message).reactions[0];
    expect(reaction?.emoji).toBe(':tada:');
    expect(reaction?.userIds).toHaveLength(2);

    await owner.request('DELETE', `/api/messages/${messageId}/reactions?emoji=%3Atada%3A`);
    const after = await owner.request<{ messages: Message[] }>(
      'GET',
      `/api/messages/${messageId}/thread`,
    );
    expect((after.body.messages[0] as Message).reactions[0]?.userIds).toHaveLength(1);
  });
});

describe('editing and deleting', () => {
  it('lets an author edit their own message but not someone else’s', async () => {
    const sent = await sendMessage(owner, general.id, 'typo herr');
    const messageId = (sent.body as { message: Message }).message.id;

    const mine = await owner.request<{ message: Message }>('PATCH', `/api/messages/${messageId}`, {
      body: 'typo here',
    });
    expect(mine.body.message.body).toBe('typo here');
    expect(mine.body.message.editedAt).not.toBeNull();

    const theirs = await member.request('PATCH', `/api/messages/${messageId}`, { body: 'nope' });
    expect(theirs.status).toBe(403);
  });

  it('clears the body of a deleted message', async () => {
    const sent = await sendMessage(member, general.id, 'delete me');
    const messageId = (sent.body as { message: Message }).message.id;

    expect((await member.request('DELETE', `/api/messages/${messageId}`)).status).toBe(200);

    const history = await owner.request<{ messages: Message[] }>(
      'GET',
      `/api/channels/${general.id}/messages?limit=100`,
    );
    const found = history.body.messages.find((m) => m.id === messageId);
    expect(found?.body ?? '').toBe('');
  });
});

describe('unread state', () => {
  it('marks a channel unread for others but not for the author', async () => {
    const sent = await sendMessage(owner, general.id, 'unread trigger');
    expect(sent.status).toBe(201);

    const authorView = await owner.request<{ channels: ChannelWithState[] }>('GET', '/api/channels');
    expect(authorView.body.channels.find((c) => c.id === general.id)?.hasUnread).toBe(false);

    const otherView = await member.request<{ channels: ChannelWithState[] }>('GET', '/api/channels');
    expect(otherView.body.channels.find((c) => c.id === general.id)?.hasUnread).toBe(true);
  });

  it('clears unread when the channel is marked read', async () => {
    const history = await member.request<{ messages: Message[] }>(
      'GET',
      `/api/channels/${general.id}/messages?limit=1`,
    );
    const latest = history.body.messages.at(-1) as Message;

    await member.request('POST', `/api/channels/${general.id}/read`, {
      lastReadMessageId: latest.id,
    });

    const view = await member.request<{ channels: ChannelWithState[] }>('GET', '/api/channels');
    expect(view.body.channels.find((c) => c.id === general.id)?.hasUnread).toBe(false);
  });

  it('never rewinds the read cursor when an older ack arrives late', async () => {
    const history = await member.request<{ messages: Message[] }>(
      'GET',
      `/api/channels/${general.id}/messages?limit=10`,
    );
    const messages = history.body.messages;
    const older = messages[0] as Message;
    const newest = messages.at(-1) as Message;

    await member.request('POST', `/api/channels/${general.id}/read`, {
      lastReadMessageId: newest.id,
    });
    const late = await member.request<{ readState: { lastReadMessageId: string } }>(
      'POST',
      `/api/channels/${general.id}/read`,
      { lastReadMessageId: older.id },
    );

    expect(late.body.readState.lastReadMessageId).toBe(newest.id);
  });
});

describe('private channels', () => {
  let secret: ChannelWithState;

  beforeAll(async () => {
    const res = await owner.request<{ channel: ChannelWithState }>('POST', '/api/channels', {
      name: 'secret-plans',
      kind: 'private',
      memberIds: [member.userId],
    });
    secret = res.body.channel;
    await sendMessage(owner, secret.id, 'the pineapple flies at midnight');
  });

  it('hides a private channel from non-members', async () => {
    const list = await outsider.request<{ channels: ChannelWithState[] }>('GET', '/api/channels');
    expect(list.body.channels.find((c) => c.id === secret.id)).toBeUndefined();
  });

  it('reports 404 rather than 403, so the channel’s existence stays private', async () => {
    const res = await outsider.request('GET', `/api/channels/${secret.id}/messages`);
    expect(res.status).toBe(404);
  });

  it('lets an invited member read it', async () => {
    const res = await member.request<{ messages: Message[] }>(
      'GET',
      `/api/channels/${secret.id}/messages`,
    );
    expect(res.status).toBe(200);
    expect(res.body.messages[0]?.body).toContain('pineapple');
  });

  // This is the security boundary called out in the build plan: search joins against
  // channel_members, and removing that join would leak private channels workspace-wide.
  it('keeps private messages out of a non-member’s search results', async () => {
    const outsiderHits = await outsider.request<{ messages: Message[] }>(
      'GET',
      '/api/search?q=pineapple',
    );
    expect(outsiderHits.body.messages).toHaveLength(0);

    const memberHits = await member.request<{ messages: Message[] }>(
      'GET',
      '/api/search?q=pineapple',
    );
    expect(memberHits.body.messages.length).toBeGreaterThan(0);
  });
});

describe('search', () => {
  it('finds a message by word', async () => {
    await sendMessage(owner, general.id, 'the quick brown fox jumped');
    const res = await owner.request<{ messages: Message[] }>('GET', '/api/search?q=brown');
    expect(res.body.messages.some((m) => m.body.includes('brown'))).toBe(true);
  });

  it('supports the from: modifier', async () => {
    await sendMessage(member, general.id, 'zephyrpineapples are unusual');
    const res = await owner.request<{ messages: Message[]; parsed: { from?: string } }>(
      'GET',
      `/api/search?q=${encodeURIComponent(`from:@${member.displayName} zephyrpineapples`)}`,
    );
    expect(res.body.parsed.from).toBe(member.displayName);
    expect(res.body.messages.every((m) => m.authorId === member.userId)).toBe(true);
  });

  it('returns nothing for a term nobody said', async () => {
    const res = await owner.request<{ messages: Message[] }>(
      'GET',
      '/api/search?q=xyzzyplughnothing',
    );
    expect(res.body.messages).toHaveLength(0);
  });
});

describe('direct messages', () => {
  it('returns the same channel when the same pair opens a DM twice', async () => {
    const first = await owner.request<{ channel: ChannelWithState }>('POST', '/api/dms', {
      userIds: [member.userId],
    });
    const second = await member.request<{ channel: ChannelWithState }>('POST', '/api/dms', {
      userIds: [owner.userId],
    });
    expect(second.body.channel.id).toBe(first.body.channel.id);
    expect(first.body.channel.kind).toBe('dm');
  });

  it('creates a distinct group DM for a larger set', async () => {
    const pair = await owner.request<{ channel: ChannelWithState }>('POST', '/api/dms', {
      userIds: [member.userId],
    });
    const trio = await owner.request<{ channel: ChannelWithState }>('POST', '/api/dms', {
      userIds: [member.userId, outsider.userId],
    });
    expect(trio.body.channel.id).not.toBe(pair.body.channel.id);
    expect(trio.body.channel.kind).toBe('group_dm');
  });
});

describe('channel lifecycle', () => {
  it('refuses a duplicate channel name', async () => {
    await owner.request('POST', '/api/channels', { name: 'design', kind: 'public' });
    const dup = await owner.request<{ error: { code: string } }>('POST', '/api/channels', {
      name: 'design',
      kind: 'public',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('channel_exists');
  });

  it('makes an archived channel read-only', async () => {
    const created = await owner.request<{ channel: ChannelWithState }>('POST', '/api/channels', {
      name: 'temporary',
      kind: 'public',
    });
    const channelId = created.body.channel.id;

    await owner.request('POST', `/api/channels/${channelId}/archive`);
    const blocked = await sendMessage(owner, channelId, 'still here?');
    expect(blocked.status).toBe(403);
  });

  it('lets a user join and leave a public channel', async () => {
    const created = await owner.request<{ channel: ChannelWithState }>('POST', '/api/channels', {
      name: 'open-house',
      kind: 'public',
    });
    const channelId = created.body.channel.id;

    expect((await outsider.request('POST', `/api/channels/${channelId}/join`)).status).toBe(200);
    expect((await sendMessage(outsider, channelId, 'hello')).status).toBe(201);
    expect((await outsider.request('POST', `/api/channels/${channelId}/leave`)).status).toBe(200);
  });
});
