import type { Message } from "@blob/shared";
import { ApiError } from "./api.ts";

const STORAGE_KEY = "blob.web.outbox.v1";

export type LocalMessageDeliveryStatus = "sending" | "queued" | "failed";

export interface LocalOutboxEntry {
  clientMsgId: string;
  channelId: string;
  threadRootId: string | null;
  body: string;
  /** Uploaded before the message was queued, so a replay re-sends the same ids. */
  attachmentIds: string[];
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
    // Entries written before attachments existed have no attachmentIds. One invalid
    // entry discards the whole outbox, so this field is optional on the way in and
    // filled here — an upgrade must not throw away someone's queued messages.
    return Object.fromEntries(
      Object.entries(parsed).map(([key, entry]) => [
        key,
        { ...entry, attachmentIds: entry.attachmentIds ?? [] },
      ]),
    );
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

export function sortOutbox(
  outbox: Record<string, LocalOutboxEntry>,
): LocalOutboxEntry[] {
  return Object.values(outbox).sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * The list's sort key for a message that has no server id yet.
 *
 * The store keeps a channel sorted by id and inserts by string comparison, which works
 * because real ids are UUIDv7 and sort chronologically. A pending id has to hold that
 * invariant up too, and `pending-${clientMsgId}` did not: `clientMsgId` is a v4 from
 * `crypto.randomUUID`, so it is random, and two messages typed while offline appeared in
 * whichever order their random ids happened to compare — commonly backwards, always
 * disagreeing with the order they would be sent and then shown in.
 *
 * The timestamp goes in front. `createdAt` is a fixed-width ISO string, so comparing it
 * as text is comparing it as time, and the id keeps a tie stable when two land in the
 * same millisecond. The `pending-` prefix stays first because six places test for it,
 * and it still sorts after every real id — 'p' is above 'f', so a queued message stays
 * below the conversation rather than being filed into the middle of it.
 */
function pendingId(entry: LocalOutboxEntry): string {
  return `pending-${entry.createdAt}-${entry.clientMsgId}`;
}

export function materializeOutboxMessage(
  entry: LocalOutboxEntry,
  authorId: string,
): Message {
  return {
    id: pendingId(entry),
    channelId: entry.channelId,
    authorId,
    kind: "user",
    body: entry.body,
    threadRootId: entry.threadRootId,
    alsoInChannel: false,
    replyCount: 0,
    replyUserIds: [],
    lastReplyAt: null,
    mentionUserIds: [],
    // Resolved by the server, so an optimistic copy names nobody. It is replaced
    // by the stored row the moment the send lands.
    mentionGroupIds: [],
    mentionsEveryone: false,
    clientMsgId: entry.clientMsgId,
    editedAt: null,
    deletedAt: null,
    pinnedAt: null,
    createdAt: entry.createdAt,
    reactions: [],
    // The entry holds ids, not the rows the server builds from them, so a pending
    // message shows its text and gains its attachments when the send lands.
    attachments: [],
    linkPreview: null,
  };
}

export function isRecoverableSendError(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return (
    error.status === 408 ||
    error.status === 425 ||
    error.status === 429 ||
    error.status >= 500
  );
}

function hasStorage(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof globalThis.localStorage !== "undefined"
  );
}

type StoredEntry = Omit<LocalOutboxEntry, "attachmentIds"> & {
  attachmentIds?: string[];
};

function isOutbox(value: unknown): value is Record<string, StoredEntry> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isOutboxEntry);
}

function isOutboxEntry(value: unknown): value is StoredEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.clientMsgId === "string" &&
    typeof value.channelId === "string" &&
    (typeof value.threadRootId === "string" || value.threadRootId === null) &&
    typeof value.body === "string" &&
    typeof value.createdAt === "string" &&
    isDeliveryStatus(value.status) &&
    typeof value.attempts === "number" &&
    (typeof value.lastError === "string" || value.lastError === null) &&
    (value.attachmentIds === undefined ||
      (Array.isArray(value.attachmentIds) &&
        value.attachmentIds.every((id) => typeof id === "string")))
  );
}

function isDeliveryStatus(value: unknown): value is LocalMessageDeliveryStatus {
  return value === "sending" || value === "queued" || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
