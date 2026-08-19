/** The signed-in user, the directory, preferences, and the boot payload. */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Bootstrap } from '@blob/shared';
import { updatePrefsSchema, updateProfileSchema, DEFAULT_PREFS } from '@blob/shared';
import { query, queryOne } from '../db/pool.ts';
import { requireAdmin, requireUser } from '../lib/auth.ts';
import { notFound } from '../lib/errors.ts';
import { publicFileUrl } from '../lib/storage.ts';
import * as channelService from '../services/channels.ts';
import { toCurrentUser, toUser, type UserRow } from '../services/serialize.ts';
import * as hub from '../realtime/hub.ts';

const USER_COLUMNS = `id, email, display_name, full_name, title, avatar_key, timezone, role,
  status_emoji, status_text, status_expires_at, prefs, deactivated_at`;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  /**
   * One request that returns everything the client needs to render. Keeping the boot
   * payload to a single round trip is why Slack eventually built Flannel; starting
   * here costs nothing and postpones that problem indefinitely.
   */
  app.get('/api/bootstrap', async (req) => {
    const session = requireUser(req);

    const [me, users, channels, emoji, workspace] = await Promise.all([
      queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [session.id]),
      query<UserRow>(
        `SELECT ${USER_COLUMNS} FROM users WHERE workspace_id = $1 ORDER BY lower(display_name)`,
        [session.workspaceId],
      ),
      channelService.listForUser(session.id, session.workspaceId),
      query<{ name: string; object_key: string }>(
        'SELECT name, object_key FROM custom_emoji WHERE workspace_id = $1 ORDER BY name',
        [session.workspaceId],
      ),
      queryOne<{ id: string; name: string; slug: string; created_at: string }>(
        'SELECT id, name, slug, created_at FROM workspaces WHERE id = $1',
        [session.workspaceId],
      ),
    ]);

    if (!me || !workspace) throw notFound('That workspace no longer exists.');

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        createdAt: workspace.created_at,
      },
      user: toCurrentUser(me),
      users: users.map(toUser),
      channels,
      customEmoji: emoji.map((e) => ({ name: e.name, url: publicFileUrl(e.object_key) })),
    } satisfies Bootstrap;
  });

  app.patch('/api/me', async (req) => {
    const session = requireUser(req);
    const input = updateProfileSchema.parse(req.body);

    await query(
      `UPDATE users
          SET display_name = COALESCE($2, display_name),
              full_name    = CASE WHEN $3::boolean THEN $4  ELSE full_name    END,
              title        = CASE WHEN $5::boolean THEN $6  ELSE title        END,
              timezone     = COALESCE($7, timezone),
              status_emoji = CASE WHEN $8::boolean THEN $9  ELSE status_emoji END,
              status_text  = CASE WHEN $10::boolean THEN $11 ELSE status_text END,
              status_expires_at = CASE WHEN $12::boolean THEN $13::timestamptz
                                       ELSE status_expires_at END
        WHERE id = $1`,
      [
        session.id,
        input.displayName ?? null,
        input.fullName !== undefined,
        input.fullName ?? null,
        input.title !== undefined,
        input.title ?? null,
        input.timezone ?? null,
        input.statusEmoji !== undefined,
        input.statusEmoji ?? null,
        input.statusText !== undefined,
        input.statusText ?? null,
        input.statusExpiresAt !== undefined,
        input.statusExpiresAt ?? null,
      ],
    );

    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [
      session.id,
    ]);
    if (!row) throw notFound('That account no longer exists.');

    hub.toAll({ t: 'user.updated', user: toUser(row) });
    return { user: toCurrentUser(row) };
  });

  app.patch('/api/me/prefs', async (req) => {
    const session = requireUser(req);
    const input = updatePrefsSchema.parse(req.body);

    // Preferences merge rather than replace, so a client that knows about fewer
    // keys than the server can still save the ones it does know.
    const row = await queryOne<UserRow>(
      `UPDATE users SET prefs = COALESCE(prefs, '{}'::jsonb) || $2::jsonb
        WHERE id = $1
        RETURNING ${USER_COLUMNS}`,
      [session.id, JSON.stringify(input)],
    );
    if (!row) throw notFound('That account no longer exists.');
    return { prefs: { ...DEFAULT_PREFS, ...(row.prefs ?? {}) } };
  });

  app.get('/api/users', async (req) => {
    const session = requireUser(req);
    const rows = await query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE workspace_id = $1 ORDER BY lower(display_name)`,
      [session.workspaceId],
    );
    return { users: rows.map(toUser) };
  });

  app.get('/api/users/:id', async (req) => {
    const session = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await queryOne<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 AND workspace_id = $2`,
      [id, session.workspaceId],
    );
    if (!row) throw notFound('There is no such person here.');
    return { user: toUser(row) };
  });

  /** Deactivation keeps the person's messages but ends their access immediately. */
  app.post('/api/admin/users/:id/deactivate', async (req) => {
    const session = requireAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === session.id) throw notFound('You cannot deactivate your own account.');

    await query(
      'UPDATE users SET deactivated_at = now() WHERE id = $1 AND workspace_id = $2',
      [id, session.workspaceId],
    );
    await query('DELETE FROM sessions WHERE user_id = $1', [id]);
    for (const conn of hub.connectionsForUser(id)) conn.close();

    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    if (row) hub.toAll({ t: 'user.updated', user: toUser(row) });
    return { ok: true };
  });

  app.post('/api/admin/users/:id/reactivate', async (req) => {
    const session = requireAdmin(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await query(
      'UPDATE users SET deactivated_at = NULL WHERE id = $1 AND workspace_id = $2',
      [id, session.workspaceId],
    );
    const row = await queryOne<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    if (row) hub.toAll({ t: 'user.updated', user: toUser(row) });
    return { ok: true };
  });

  /** Web push registration. */
  app.post('/api/me/push-subscription', async (req) => {
    const session = requireUser(req);
    const { endpoint, keys } = z
      .object({
        endpoint: z.string().url(),
        keys: z.object({ p256dh: z.string(), auth: z.string() }),
      })
      .parse(req.body);

    const { newId } = await import('../lib/ids.ts');
    await query(
      `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [newId(), session.id, endpoint, keys.p256dh, keys.auth],
    );
    return { ok: true };
  });

  app.delete('/api/me/push-subscription', async (req) => {
    const session = requireUser(req);
    const { endpoint } = z.object({ endpoint: z.string().url() }).parse(req.body);
    await query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [
      session.id,
      endpoint,
    ]);
    return { ok: true };
  });
}
