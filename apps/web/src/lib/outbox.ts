import type { Message } from '@blob/shared';
import { ApiError } from './api.ts';

const STORAGE_KEY = 'blob.web.outbox.v1';

export type LocalMessageDeliveryStatus = 'sending' | 'queued' | 'failed';

export interface LocalOutboxEntry {
  clientMsgId: string;
  channelId: string;
  threadRootId: string | null;
  body: string;
  createdAt: string;
  status: LocalMessageDeliveryStatus;
  attempts: number;
  lastError: string | null;
}

export function loadOutbox(): Record<string, LocalOutboxEntry> {
  if (!hasStorage()) return {};
  const raw = globalThis.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isOutbox(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function persistOutbox(outbox: Record<string, LocalOutboxEntry>): void {
  if (!hasStorage()) return;
  if (Object.keys(outbox).length === 0) {
    globalThis.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(outbox));
}

export function sortOutbox(outbox: Record<string, LocalOutboxEntry>): LocalOutboxEntry[] {
  return Object.values(outbox).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function materializeOutboxMessage(entry: LocalOutboxEntry, authorId: string): Message {
  return {
    id: `pending-${entry.clientMsgId}`,
    channelId: entry.channelId,
    authorId,
    kind: 'user',
    body: entry.body,
    threadRootId: entry.threadRootId,
    alsoInChannel: false,
    replyCount: 0,
    replyUserIds: [],
    lastReplyAt: null,
    mentionUserIds: [],
    mentionsEveryone: false,
    clientMsgId: entry.clientMsgId,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: entry.createdAt,
    reactions: [],
    attachments: [],
    linkPreview: null,
  };
}

export function isRecoverableSendError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof globalThis.localStorage !== 'undefined';
}

function isOutbox(value: unknown): value is Record<string, LocalOutboxEntry> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isOutboxEntry);
}

function isOutboxEntry(value: unknown): value is LocalOutboxEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.clientMsgId === 'string' &&
    typeof value.channelId === 'string' &&
    (typeof value.threadRootId === 'string' || value.threadRootId === null) &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'string' &&
    isDeliveryStatus(value.status) &&
    typeof value.attempts === 'number' &&
    (typeof value.lastError === 'string' || value.lastError === null)
  );
}

function isDeliveryStatus(value: unknown): value is LocalMessageDeliveryStatus {
  return value === 'sending' || value === 'queued' || value === 'failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
