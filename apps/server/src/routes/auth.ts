/** Signup, login, invites, password reset. */

import type { FastifyInstance } from 'fastify';
import {
  createInviteSchema,
  loginSchema,
  signupSchema,
  type CurrentUser,
} from '@blob/shared';
import { z } from 'zod';
import { config } from '../config.ts';
import { query, queryOne, transaction } from '../db/pool.ts';
import {
  clearSessionCookie,
  createSession,
  destroyOtherSessions,
  destroySession,
  hashPassword,
  hashToken,
  requireAdmin,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from '../lib/auth.ts';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.ts';
import { newId, newToken } from '../lib/ids.ts';
import { sendInvite, sendPasswordReset } from '../lib/mail.ts';
import { consume } from '../lib/rate-limit.ts';
import { addMembers, DEFAULT_CHANNELS } from '../services/channels.ts';
import { toCurrentUser, type UserRow } from '../services/serialize.ts';

const USER_COLUMNS = `id, email, display_name, full_name, title, avatar_key, timezone, role,
  status_emoji, status_text, status_expires_at, prefs, deactivated_at`;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Is this a fresh install? The first person to sign up founds the workspace. */
  app.get('/api/auth/state', async () => {
    const row = await queryOne<{ count: number }>('SELECT count(*)::int AS count FROM workspaces');
    return { needsSetup: (row?.count ?? 0) === 0 };
  });

  app.post('/api/auth/signup', async (req, reply) => {
    const input = signupSchema.parse(req.body);
    await consume('signup', req.ip);

    const workspace = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM workspaces ORDER BY created_at LIMIT 1',
    );

    const user = await transaction(async (client) => {
      let workspaceId: string;
      let role: 'owner' | 'member' = 'member';

      if (!workspace) {
        // First ever signup: create the workspace and make this person its owner.
        workspaceId = newId();
        role = 'owner';
        const name = input.workspaceName?.trim() || 'Workspace';
        await client.query('INSERT INTO workspaces (id, name, slug) VALUES ($1, $2, $3)', [
          workspaceId,
          name,
          slugify(name),
        ]);
      } else {
        workspaceId = workspace.id;
        if (!input.inviteToken) throw unauthorized('You need an invitation to join.');

        const invite = await queryOne<{ id: string; email: string | null }>(
          `SELECT id, email FROM invites
            WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now()`,
          [hashToken(input.inviteToken)],
          client,
        );
        if (!invite) throw unauthorized('That invitation has expired or was already used.');
        if (invite.email && invite.email.toLowerCase() !== input.email) {
          throw badRequest('That invitation was issued for a different email address.');
        }
        await client.query('UPDATE invites SET accepted_at = now() WHERE id = $1', [invite.id]);
      }

      const userId = newId();
      try {
        await client.query(
          `INSERT INTO users (id, workspace_id, email, password_hash, display_name, role)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            userId,
            workspaceId,
            input.email,
            await hashPassword(input.password),
            input.displayName,
            role,
          ],
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw conflict('That email or display name is already taken.', 'user_exists');
        }
        throw err;
      }

      if (!workspace) {
        for (const name of DEFAULT_CHANNELS) {
          const channelId = newId();
          await client.query(
            `INSERT INTO channels (id, workspace_id, kind, name, created_by)
             VALUES ($1, $2, 'public', $3, $4)`,
            [channelId, workspaceId, name, userId],
          );
          await addMembers(channelId, [userId], client);
        }
      } else {
        // Join every default channel that exists.
        const defaults = await client.query<{ id: string }>(
          `SELECT id FROM channels
            WHERE workspace_id = $1 AND kind = 'public' AND name = ANY($2::text[])`,
          [workspaceId, [...DEFAULT_CHANNELS]],
        );
        for (const row of defaults.rows) await addMembers(row.id, [userId], client);
      }

      if (invitesTable(workspace) && input.inviteToken) {
        await client.query(
          'UPDATE invites SET accepted_by = $1 WHERE token_hash = $2',
          [userId, hashToken(input.inviteToken)],
        );
      }

      const created = await queryOne<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
        [userId],
        client,
      );
      if (!created) throw badRequest('Could not create that account.');
      return created;
    });

    const token = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token);
    return { user: toCurrentUser(user) satisfies CurrentUser };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = loginSchema.parse(req.body);
    await consume('login', req.ip);

    const row = await queryOne<UserRow & { password_hash: string | null }>(
      `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = $1`,
      [input.email],
    );

    // Same message either way — never reveal whether an address is registered.
    const invalid = unauthorized('That email or password is incorrect.');
    if (!row?.password_hash) throw invalid;
    if (row.deactivated_at) throw unauthorized('That account has been deactivated.');
    if (!(await verifyPassword(row.password_hash, input.password))) throw invalid;

    const token = await createSession(row.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, token);
    return { user: toCurrentUser(row) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.user) await destroySession(req.user.sessionId);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/api/auth/logout-others', async (req) => {
    const user = requireUser(req);
    await destroyOtherSessions(user.id, user.sessionId);
    return { ok: true };
  });

  app.get('/api/auth/sessions', async (req) => {
    const user = requireUser(req);
    const rows = await query<{
      id: string;
      user_agent: string | null;
      ip: string | null;
      created_at: string;
      last_seen_at: string;
    }>(
      `SELECT id, user_agent, ip, created_at, last_seen_at
         FROM sessions WHERE user_id = $1 ORDER BY last_seen_at DESC`,
      [user.id],
    );
    return {
      sessions: rows.map((r) => ({
        id: r.id,
        current: r.id === user.sessionId,
        userAgent: r.user_agent,
        ip: r.ip,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
      })),
    };
  });

  // ─── invitations ──────────────────────────────────────────────────────────
  app.post('/api/invites', async (req) => {
    const user = requireAdmin(req);
    const input = createInviteSchema.parse(req.body ?? {});

    const token = newToken();
    const expiresAt = new Date(Date.now() + input.expiresInDays * 86_400_000);
    await query(
      `INSERT INTO invites (id, workspace_id, email, token_hash, created_by, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [newId(), user.workspaceId, input.email ?? null, hashToken(token), user.id, expiresAt],
    );

    const url = `${config.PUBLIC_URL}/join/${token}`;
    if (input.email) {
      const workspace = await queryOne<{ name: string }>(
        'SELECT name FROM workspaces WHERE id = $1',
        [user.workspaceId],
      );
      await sendInvite(input.email, user.displayName, url, workspace?.name ?? 'the workspace');
    }
    return { url, expiresAt: expiresAt.toISOString() };
  });

  app.get('/api/invites/:token', async (req) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.params);
    const invite = await queryOne<{ email: string | null; workspace: string }>(
      `SELECT i.email, w.name AS workspace
         FROM invites i JOIN workspaces w ON w.id = i.workspace_id
        WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()`,
      [hashToken(token)],
    );
    if (!invite) throw notFound('That invitation has expired or was already used.');
    return { email: invite.email, workspace: invite.workspace };
  });

  // ─── password reset ───────────────────────────────────────────────────────
  app.post('/api/auth/forgot-password', async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body);
    await consume('passwordReset', req.ip);

    const user = await queryOne<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND deactivated_at IS NULL',
      [email],
    );
    // Always report success — otherwise this endpoint enumerates accounts.
    if (user) {
      const token = newToken();
      await query(
        `INSERT INTO password_resets (id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [newId(), user.id, hashToken(token)],
      );
      await sendPasswordReset(email, `${config.PUBLIC_URL}/reset/${token}`);
    }
    return { ok: true };
  });

  app.post('/api/auth/reset-password', async (req, reply) => {
    const { token, password } = z
      .object({ token: z.string().min(10), password: z.string().min(10).max(200) })
      .parse(req.body);

    const reset = await queryOne<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM password_resets
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [hashToken(token)],
    );
    if (!reset) throw badRequest('That reset link has expired. Request a new one.');

    await transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
        reset.user_id,
        await hashPassword(password),
      ]);
      await client.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);
      // Changing a password signs out every existing session.
      await client.query('DELETE FROM sessions WHERE user_id = $1', [reset.user_id]);
    });

    const sessionToken = await createSession(reset.user_id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    });
    setSessionCookie(reply, sessionToken);
    return { ok: true };
  });
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

/** Invites only exist once a workspace does. */
function invitesTable(workspace: unknown): boolean {
  return workspace !== null;
}
