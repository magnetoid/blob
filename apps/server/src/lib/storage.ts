/**
 * Object storage (MinIO in dev, any S3 in prod).
 *
 * Browsers upload straight to the bucket with a presigned PUT — the app never proxies
 * file bytes. The bucket itself stays private; every read is a short-lived presigned
 * GET issued per request.
 */

import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.ts';
import { newId } from './ids.ts';

export const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: config.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
});

const UPLOAD_URL_TTL_SEC = 900; // 15 minutes to start the upload
const DOWNLOAD_URL_TTL_SEC = 3600;

/** Images render inline; everything else downloads. Never render SVG inline. */
const INLINE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export function isInlineImage(mime: string): boolean {
  return INLINE_MIME.has(mime.toLowerCase());
}

/** Server chooses keys so a client can never overwrite someone else's object. */
export function buildObjectKey(workspaceId: string, filename: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-120);
  return `${workspaceId}/${yyyy}/${mm}/${newId()}/${safe}`;
}

export async function presignUpload(key: string, mime: string): Promise<string> {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, ContentType: mime }),
    { expiresIn: UPLOAD_URL_TTL_SEC },
  );
}

export async function presignDownload(
  key: string,
  opts: { filename?: string; mime?: string } = {},
): Promise<string> {
  const disposition =
    opts.mime && isInlineImage(opts.mime)
      ? 'inline'
      : `attachment; filename="${(opts.filename ?? 'file').replace(/"/g, '')}"`;
  return getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: config.S3_BUCKET,
      Key: key,
      ResponseContentDisposition: disposition,
    }),
    { expiresIn: DOWNLOAD_URL_TTL_SEC },
  );
}

/**
 * Stable URL that routes through the API, which redirects to a fresh presigned GET.
 * Serialized objects embed this rather than a signed URL, so cached message payloads
 * never contain an expiring link.
 */
export function publicFileUrl(key: string): string {
  return `/api/files/${encodeURIComponent(key)}`;
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export async function putObject(key: string, body: Buffer, mime: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: mime }),
  );
}
