/**
 * Uploads and downloads.
 *
 * The browser uploads straight to object storage with a presigned PUT — file bytes
 * never pass through this process. Downloads redirect to a short-lived presigned GET,
 * so stored message payloads hold a stable URL rather than an expiring one.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uploadRequestSchema } from '@blob/shared';
import { query, queryOne } from '../db/pool.ts';
import { requireUser } from '../lib/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { newId } from '../lib/ids.ts';
import { consume } from '../lib/rate-limit.ts';
import { buildObjectKey, presignDownload, presignUpload } from '../lib/storage.ts';

/** Extensions we refuse outright — executables and inline-scriptable formats. */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'sh', 'app', 'jar', 'svg', 'html', 'htm',
]);

export async function fileRoutes(app: FastifyInstance): Promise<void> {
  /** Step 1: ask for somewhere to put the file. */
  app.post('/api/uploads', async (req) => {
    const user = requireUser(req);
    const input = uploadRequestSchema.parse(req.body);
    await consume('upload', user.id);

    const ext = input.filename.split('.').pop()?.toLowerCase() ?? '';
    if (BLOCKED_EXTENSIONS.has(ext)) {
      throw badRequest(`.${ext} files can't be shared here.`);
    }

    const attachmentId = newId();
    const objectKey = buildObjectKey(user.workspaceId, input.filename);

    await query(
      `INSERT INTO attachments
         (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        attachmentId,
        user.workspaceId,
        user.id,
        objectKey,
        input.filename,
        input.mime,
        input.sizeBytes,
      ],
    );

    return {
      attachmentId,
      uploadUrl: await presignUpload(objectKey, input.mime),
      method: 'PUT' as const,
      headers: { 'Content-Type': input.mime },
    };
  });

  /** Step 2: tell us the upload finished (and, for images, how big it is). */
  app.post('/api/uploads/:id/complete', async (req) => {
    const user = requireUser(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { width, height } = z
      .object({
        width: z.coerce.number().int().positive().max(20_000).optional(),
        height: z.coerce.number().int().positive().max(20_000).optional(),
      })
      .parse(req.body ?? {});

    const rows = await query(
      `UPDATE attachments
          SET uploaded_at = now(), width = COALESCE($3, width), height = COALESCE($4, height)
        WHERE id = $1 AND uploader_id = $2
        RETURNING id`,
      [id, user.id, width ?? null, height ?? null],
    );
    if (rows.length === 0) throw notFound('That upload has expired.');
    return { ok: true };
  });

  /**
   * Stable download URL. Authorization is by membership of the channel the file was
   * posted in; an unattached file is visible only to whoever uploaded it.
   */
  app.get('/api/files/*', async (req, reply) => {
    const user = requireUser(req);
    const objectKey = decodeURIComponent((req.params as Record<string, string>)['*'] ?? '');
    if (!objectKey) throw notFound('No such file.');

    const file = await queryOne<{
      filename: string;
      mime: string;
      message_id: string | null;
      uploader_id: string;
      channel_member: string | null;
    }>(
      `SELECT a.filename, a.mime, a.message_id, a.uploader_id,
              cm.user_id AS channel_member
         FROM attachments a
         LEFT JOIN messages m ON m.id = a.message_id
         LEFT JOIN channel_members cm
                ON cm.channel_id = m.channel_id AND cm.user_id = $2
        WHERE a.object_key = $1 AND a.workspace_id = $3`,
      [objectKey, user.id, user.workspaceId],
    );

    if (!file) {
      // Avatars and custom emoji are workspace-wide and have no attachment row.
      const shared = await queryOne<{ key: string }>(
        `SELECT object_key AS key FROM custom_emoji
          WHERE workspace_id = $1 AND object_key = $2
         UNION ALL
         SELECT avatar_key FROM users WHERE workspace_id = $1 AND avatar_key = $2`,
        [user.workspaceId, objectKey],
      );
      if (!shared) throw notFound('No such file.');
      return reply.redirect(await presignDownload(objectKey, { mime: 'image/png' }));
    }

    const allowed = file.message_id ? file.channel_member !== null : file.uploader_id === user.id;
    if (!allowed) throw notFound('No such file.');

    return reply.redirect(
      await presignDownload(objectKey, { filename: file.filename, mime: file.mime }),
    );
  });
}
