/** Request validation shared by the server (enforcement) and web (client-side checks). */

import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'That password is too long.');

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a display name.')
  .max(40, 'Display names are limited to 40 characters.');

/** Lowercase, digits, hyphens — the convention every chat app converged on. */
export const channelNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Enter a channel name.')
  .max(64, 'Channel names are limited to 64 characters.')
  .regex(/^[a-z0-9][a-z0-9-_]*$/, 'Use lowercase letters, numbers, hyphens and underscores.');

export const signupSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: displayNameSchema,
  /** Present unless this is the very first user, who founds the workspace. */
  inviteToken: z.string().min(10).optional(),
  workspaceName: z.string().trim().min(1).max(60).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});

export const createChannelSchema = z.object({
  name: channelNameSchema,
  kind: z.enum(['public', 'private']),
  topic: z.string().trim().max(250).optional(),
  description: z.string().trim().max(2000).optional(),
  memberIds: z.array(z.string().uuid()).max(200).optional(),
});

export const updateChannelSchema = z.object({
  name: channelNameSchema.optional(),
  topic: z.string().trim().max(250).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const MESSAGE_MAX_LENGTH = 12_000;

export const sendMessageSchema = z
  .object({
    body: z.string().max(MESSAGE_MAX_LENGTH).default(''),
    clientMsgId: z.string().min(8).max(64),
    threadRootId: z.string().uuid().nullable().optional(),
    alsoInChannel: z.boolean().optional(),
    attachmentIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .refine((m) => m.body.trim().length > 0 || (m.attachmentIds?.length ?? 0) > 0, {
    message: 'Write something or attach a file.',
    path: ['body'],
  });

export const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX_LENGTH),
});

/** `:emoji:` or a raw unicode emoji. */
export const reactionSchema = z.object({
  emoji: z.string().min(1).max(64),
});

export const markReadSchema = z.object({
  lastReadMessageId: z.string().uuid(),
});

export const membershipUpdateSchema = z.object({
  notifyLevel: z.enum(['all', 'mentions', 'none']).optional(),
  isStarred: z.boolean().optional(),
});

export const updatePrefsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  density: z.enum(['comfortable', 'compact', 'airy']).optional(),
  themeLight: z.string().max(40).optional(),
  themeDark: z.string().max(40).optional(),
  keywords: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  dnd: z
    .object({
      enabled: z.boolean(),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
      days: z.array(z.number().int().min(0).max(6)).max(7),
    })
    .nullable()
    .optional(),
  snoozeUntil: z.string().datetime().nullable().optional(),
  enterToSend: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  displayName: displayNameSchema.optional(),
  fullName: z.string().trim().max(80).nullable().optional(),
  title: z.string().trim().max(80).nullable().optional(),
  timezone: z.string().max(60).optional(),
  statusEmoji: z.string().max(64).nullable().optional(),
  statusText: z.string().trim().max(100).nullable().optional(),
  statusExpiresAt: z.string().datetime().nullable().optional(),
});

export const createDmSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(8),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  from: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  after: z.string().datetime().optional(),
  has: z.enum(['link', 'file']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

export const historyQuerySchema = z.object({
  /** Keyset cursor: return messages older than this id. */
  before: z.string().uuid().optional(),
  after: z.string().uuid().optional(),
  around: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const createInviteSchema = z.object({
  email: emailSchema.optional(),
  expiresInDays: z.coerce.number().int().min(1).max(30).default(7),
});

export const uploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mime: z.string().trim().min(1).max(150),
  sizeBytes: z.coerce
    .number()
    .int()
    .min(1)
    .max(100 * 1024 * 1024, 'Files are limited to 100 MB.'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateChannelInput = z.infer<typeof createChannelSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;
export type HistoryQueryInput = z.infer<typeof historyQuerySchema>;
