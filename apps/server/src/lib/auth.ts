/**
 * Sessions and passwords.
 *
 * Sessions are opaque random tokens in an httpOnly cookie, stored server-side as a
 * SHA-256 digest. Chosen over JWTs because instant revocation matters more than
 * statelessness here: logging out a stolen laptop has to take effect now, not at
 * token expiry.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.ts';
import { query, queryOne } from '../db/pool.ts';
import { newId, newToken } from './ids.ts';
import { unauthorized } from './errors.ts';

export const SESSION_COOKIE = 'blob_session';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain);
}

export async function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hashValue, plain);
  } catch {
    return false;
  }
}

/** Constant-time compare for tokens we look up by digest. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export interface SessionUser {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: 'member' | 'admin' | 'owner';
  sessionId: string;
}

export async function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<string> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
  await query(
    `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), userId, hashToken(token), meta.userAgent ?? null, meta.ip ?? null, expiresAt],
  );
  return token;
}

export async function resolveSession(token: string): Promise<SessionUser | null> {
  const row = await queryOne<{
    session_id: string;
    id: string;
    workspace_id: string;
    email: string;
    display_name: string;
    role: SessionUser['role'];
  }>(
    `SELECT s.id AS session_id, u.id, u.workspace_id, u.email, u.display_name, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.expires_at > now()
        AND u.deactivated_at IS NULL`,
    [hashToken(token)],
  );
  if (!row) return null;

  // Touch last_seen_at at most once a minute; this runs on every request.
  void query(
    `UPDATE sessions SET last_seen_at = now()
      WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`,
    [row.session_id],
  ).catch(() => {});

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    sessionId: row.session_id,
  };
}

export async function destroySession(sessionId: string): Promise<void> {
  await query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

/** Sign out everywhere, optionally keeping the session making the request. */
export async function destroyOtherSessions(userId: string, keepSessionId?: string): Promise<void> {
  await query('DELETE FROM sessions WHERE user_id = $1 AND ($2::uuid IS NULL OR id <> $2)', [
    userId,
    keepSessionId ?? null,
  ]);
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: config.SESSION_TTL_DAYS * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Returns the signed-in user or throws 401. */
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (user.role !== 'admin' && user.role !== 'owner') {
    throw unauthorized("You need admin access for that.");
  }
  return user;
}
