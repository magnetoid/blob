/** Environment configuration, validated once at boot so misconfiguration fails loudly. */

import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters.'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('blob-files'),
  S3_ACCESS_KEY: z.string().default('blobadmin'),
  S3_SECRET_KEY: z.string().default('blobadmin123'),
  S3_FORCE_PATH_STYLE: bool(true),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Blob <chat@example.com>'),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@example.com'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`Configuration is invalid:\n${problems}\n\nCopy .env.example to .env and fill it in.`);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  s3PublicEndpoint: parsed.data.S3_PUBLIC_ENDPOINT ?? parsed.data.S3_ENDPOINT,
  pushEnabled: Boolean(parsed.data.VAPID_PUBLIC_KEY && parsed.data.VAPID_PRIVATE_KEY),
};

export type Config = typeof config;
