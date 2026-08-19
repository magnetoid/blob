/**
 * WebSocket server.
 *
 * Deliberately thin: it authenticates, subscribes the connection to the user's
 * channels, and relays events. It accepts no writes — every mutation goes through
 * REST, so a socket outage degrades to "no live updates", never to lost data.
 *
 * This module imports nothing from routes/, so it can move to its own process
 * unchanged when connection counts justify it.
 */

import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientFrame, ServerEvent } from '@blob/shared';
import { HEARTBEAT_MS, TYPING_THROTTLE_MS, WS_PATH } from '@blob/shared';
import { resolveSession, SESSION_COOKIE } from '../lib/auth.ts';
import { query } from '../db/pool.ts';
import { newId } from '../lib/ids.ts';
import * as hub from './hub.ts';
import * as presence from './presence.ts';

/** Two missed heartbeats and the connection is considered dead. */
const DEAD_AFTER_MS = HEARTBEAT_MS * 2 + 5_000;

export function attachWebSocketServer(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith(WS_PATH)) {
      socket.destroy();
      return;
    }
    void (async () => {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const user = token ? await resolveSession(token) : null;
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        void onConnection(ws, user.id);
      });
    })();
  });

  return wss;
}

async function onConnection(ws: WebSocket, userId: string): Promise<void> {
  const conn: hub.Connection = {
    id: newId(),
    userId,
    channelIds: new Set(),
    presenceSubs: new Set(),
    focusedChannelId: null,
    send(event: ServerEvent) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
    },
    close() {
      ws.close();
    },
  };

  hub.register(conn);

  // Subscribe to every channel this user belongs to. At this scale that is a few
  // dozen ids; the channel-affinity work in §8 only matters far above it.
  const rows = await query<{ channel_id: string }>(
    'SELECT channel_id FROM channel_members WHERE user_id = $1',
    [userId],
  );
  hub.subscribeChannels(
    conn,
    rows.map((r) => r.channel_id),
  );

  conn.send({ t: 'hello', userId, serverTime: new Date().toISOString() });
  await presence.markActive(userId);

  let lastSeen = Date.now();
  let lastTypingAt = 0;

  const heartbeat = setInterval(() => {
    if (Date.now() - lastSeen > DEAD_AFTER_MS) {
      ws.terminate();
      return;
    }
    void presence.markActive(userId).catch(() => {});
  }, HEARTBEAT_MS);

  ws.on('message', (raw) => {
    lastSeen = Date.now();
    let frame: ClientFrame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (frame.t) {
      case 'ping':
        conn.send({ t: 'pong' });
        break;

      case 'presence.sub': {
        conn.presenceSubs.clear();
        for (const id of frame.userIds.slice(0, 500)) conn.presenceSubs.add(id);
        void presence.getPresence([...conn.presenceSubs]).then((states) => {
          for (const [id, state] of Object.entries(states)) {
            conn.send({ t: 'presence', userId: id, state });
          }
        });
        break;
      }

      case 'typing': {
        const now = Date.now();
        if (now - lastTypingAt < TYPING_THROTTLE_MS) break;
        if (!conn.channelIds.has(frame.channelId)) break;
        lastTypingAt = now;
        void presence
          .setTyping(frame.channelId, userId, frame.threadRootId ?? null)
          .catch(() => {});
        break;
      }

      case 'channel.focus':
        conn.focusedChannelId = frame.channelId;
        break;
    }
  });

  ws.on('pong', () => {
    lastSeen = Date.now();
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    hub.unregister(conn);
    void presence.markOffline(userId).catch(() => {});
  });

  ws.on('error', () => {
    ws.terminate();
  });
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
