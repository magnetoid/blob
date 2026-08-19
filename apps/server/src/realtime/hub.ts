/**
 * Event fan-out.
 *
 * Connections register interest by user and by channel. Every emit goes to local
 * sockets and is published to Redis, where sibling app processes re-broadcast to
 * theirs — so running a second container needs no code change.
 *
 * Nothing here writes to Postgres. Emits happen *after* the transaction that
 * produced them has committed; see db/pool.ts.
 */

import type { ServerEvent } from '@blob/shared';
import { EVENTS_CHANNEL, redis, redisSub } from '../lib/redis.ts';

export interface Connection {
  id: string;
  userId: string;
  send(event: ServerEvent): void;
  close(): void;
  /** Channels this connection currently receives events for. */
  channelIds: Set<string>;
  /** Users whose presence this connection asked for (Slack's presence_sub). */
  presenceSubs: Set<string>;
  /** The channel the user is looking at right now, if any. */
  focusedChannelId: string | null;
}

/** An envelope published to Redis so other processes know who should receive it. */
interface Envelope {
  origin: string;
  event: ServerEvent;
  to: { channelId?: string; userIds?: string[]; all?: boolean };
}

const PROCESS_ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

const byConnection = new Map<string, Connection>();
const byUser = new Map<string, Set<Connection>>();
const byChannel = new Map<string, Set<Connection>>();

export function register(conn: Connection): void {
  byConnection.set(conn.id, conn);
  addTo(byUser, conn.userId, conn);
}

export function unregister(conn: Connection): void {
  byConnection.delete(conn.id);
  removeFrom(byUser, conn.userId, conn);
  for (const channelId of conn.channelIds) removeFrom(byChannel, channelId, conn);
  conn.channelIds.clear();
  conn.presenceSubs.clear();
}

export function subscribeChannels(conn: Connection, channelIds: string[]): void {
  for (const id of channelIds) {
    if (conn.channelIds.has(id)) continue;
    conn.channelIds.add(id);
    addTo(byChannel, id, conn);
  }
}

export function unsubscribeChannel(conn: Connection, channelId: string): void {
  if (!conn.channelIds.delete(channelId)) return;
  removeFrom(byChannel, channelId, conn);
}

/** Everyone currently subscribed to a channel. */
export function toChannel(channelId: string, event: ServerEvent): void {
  deliverLocal(event, { channelId });
  publish({ origin: PROCESS_ID, event, to: { channelId } });
}

/** Every connection belonging to these users (all their devices). */
export function toUsers(userIds: string[], event: ServerEvent): void {
  if (userIds.length === 0) return;
  deliverLocal(event, { userIds });
  publish({ origin: PROCESS_ID, event, to: { userIds } });
}

/** Everyone connected — used for workspace-wide facts like a profile change. */
export function toAll(event: ServerEvent): void {
  deliverLocal(event, { all: true });
  publish({ origin: PROCESS_ID, event, to: { all: true } });
}

/** Presence updates go only to connections that asked about this user. */
export function toPresenceSubscribers(userId: string, event: ServerEvent): void {
  for (const conn of byConnection.values()) {
    if (conn.presenceSubs.has(userId)) conn.send(event);
  }
  publish({ origin: PROCESS_ID, event, to: { userIds: ['*presence*'] } });
}

export function isUserOnline(userId: string): boolean {
  return (byUser.get(userId)?.size ?? 0) > 0;
}

/** Which channel each of a user's connections is currently focused on. */
export function focusedChannels(userId: string): Set<string> {
  const result = new Set<string>();
  for (const conn of byUser.get(userId) ?? []) {
    if (conn.focusedChannelId) result.add(conn.focusedChannelId);
  }
  return result;
}

export function stats() {
  return {
    connections: byConnection.size,
    users: byUser.size,
    channels: byChannel.size,
  };
}

export function connectionsForUser(userId: string): Connection[] {
  return [...(byUser.get(userId) ?? [])];
}

function deliverLocal(event: ServerEvent, to: Envelope['to']): void {
  if (to.all) {
    for (const conn of byConnection.values()) conn.send(event);
    return;
  }
  if (to.channelId) {
    for (const conn of byChannel.get(to.channelId) ?? []) conn.send(event);
    return;
  }
  if (to.userIds) {
    const seen = new Set<string>();
    for (const userId of to.userIds) {
      for (const conn of byUser.get(userId) ?? []) {
        if (seen.has(conn.id)) continue;
        seen.add(conn.id);
        conn.send(event);
      }
    }
  }
}

function publish(envelope: Envelope): void {
  // Presence fan-out is per-connection state, not addressable across processes;
  // sibling processes rebuild it from their own subscriptions.
  if (envelope.to.userIds?.[0] === '*presence*') {
    void redis
      .publish(EVENTS_CHANNEL, JSON.stringify({ ...envelope, to: { presence: true } }))
      .catch(() => {});
    return;
  }
  void redis.publish(EVENTS_CHANNEL, JSON.stringify(envelope)).catch(() => {});
}

let bridgeStarted = false;

/** Re-broadcast events published by sibling processes to our local connections. */
export async function startRedisBridge(): Promise<void> {
  if (bridgeStarted) return;
  bridgeStarted = true;
  await redisSub.subscribe(EVENTS_CHANNEL);
  redisSub.on('message', (channel, payload) => {
    if (channel !== EVENTS_CHANNEL) return;
    let envelope: Envelope & { to: Envelope['to'] & { presence?: boolean } };
    try {
      envelope = JSON.parse(payload);
    } catch {
      return;
    }
    if (envelope.origin === PROCESS_ID) return;

    if (envelope.to.presence) {
      const event = envelope.event;
      if (event.t === 'presence') {
        for (const conn of byConnection.values()) {
          if (conn.presenceSubs.has(event.userId)) conn.send(event);
        }
      }
      return;
    }
    deliverLocal(envelope.event, envelope.to);
  });
}

function addTo<T>(map: Map<string, Set<T>>, key: string, value: T): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function removeFrom<T>(map: Map<string, Set<T>>, key: string, value: T): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}
