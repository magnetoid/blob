/** Shared test utilities: a running app, a clean database, and signed-in clients. */

import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index.ts';
import { migrate } from '../src/db/migrate.ts';
import { pool } from '../src/db/pool.ts';
import { redis } from '../src/lib/redis.ts';

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (app) return app;
  await migrate(() => {});
  app = await buildApp();
  await app.ready();
  return app;
}

export async function resetDatabase(): Promise<void> {
  await migrate(() => {});
  // Rate-limit counters and presence live in Redis and would otherwise leak between
  // runs — a previous run's signup attempts would exhaust this run's budget.
  await redis.flushdb();
  await pool.query(`
    TRUNCATE workspaces, users, sessions, invites, password_resets, channels,
             channel_members, messages, reactions, attachments, custom_emoji,
             read_states, thread_subscriptions, push_subscriptions, webhooks
    RESTART IDENTITY CASCADE
  `);
}

export interface TestClient {
  userId: string;
  cookie: string;
  displayName: string;
  request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }>;
}

/** Signs up a user (founding the workspace if it doesn't exist) and returns a client. */
export async function signUp(
  displayName: string,
  email = `${displayName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
): Promise<TestClient> {
  const instance = await getApp();

  // Only the first signup founds the workspace; later ones need an invitation.
  const state = await instance.inject({ method: 'GET', url: '/api/auth/state' });
  const needsSetup = state.json<{ needsSetup: boolean }>().needsSetup;

  let inviteToken: string | undefined;
  if (!needsSetup) {
    const owner = await ownerClient();
    const invite = await owner.request<{ url: string }>('POST', '/api/invites', {
      expiresInDays: 1,
    });
    inviteToken = invite.body.url.split('/join/')[1];
  }

  const res = await instance.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      email,
      password: 'correct-horse-battery',
      displayName,
      workspaceName: needsSetup ? 'Test Workspace' : undefined,
      inviteToken,
    },
  });

  if (res.statusCode >= 400) {
    throw new Error(`signup failed for ${displayName}: ${res.body}`);
  }

  const cookie = extractCookie(res.headers['set-cookie']);
  const userId = res.json<{ user: { id: string } }>().user.id;
  if (!cachedOwner) cachedOwner = makeClient(userId, cookie, displayName);
  return makeClient(userId, cookie, displayName);
}

let cachedOwner: TestClient | null = null;

async function ownerClient(): Promise<TestClient> {
  if (!cachedOwner) throw new Error('no workspace owner yet — sign up the first user first');
  return cachedOwner;
}

export function forgetOwner(): void {
  cachedOwner = null;
}

function makeClient(userId: string, cookie: string, displayName: string): TestClient {
  return {
    userId,
    cookie,
    displayName,
    async request(method, url, body) {
      const instance = await getApp();
      const res = await instance.inject({
        method,
        url,
        // Only declare a JSON body when there is one; Fastify rejects the
        // combination of a JSON content-type and an empty payload.
        headers: body === undefined ? { cookie } : { cookie, 'content-type': 'application/json' },
        payload: body === undefined ? undefined : (body as object),
      });
      let parsed: unknown = null;
      try {
        parsed = res.body ? JSON.parse(res.body) : null;
      } catch {
        parsed = res.body;
      }
      return { status: res.statusCode, body: parsed as never };
    },
  };
}

function extractCookie(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header.join(';') : (header ?? '');
  const match = raw.match(/blob_session=([^;]+)/);
  if (!match) throw new Error('no session cookie in response');
  return `blob_session=${match[1]}`;
}

/** Convenience for the very common "send a message" call. */
export async function sendMessage(
  client: TestClient,
  channelId: string,
  body: string,
  extra: Record<string, unknown> = {},
) {
  return client.request<{ message: { id: string; body: string } }>(
    'POST',
    `/api/channels/${channelId}/messages`,
    {
      body,
      clientMsgId: `test-${Math.random().toString(36).slice(2)}-${Date.now()}`,
      ...extra,
    },
  );
}
