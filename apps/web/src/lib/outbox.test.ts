import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from './api.ts';
import {
  isRecoverableSendError,
  loadOutbox,
  materializeOutboxMessage,
  persistOutbox,
  type LocalOutboxEntry,
} from './outbox.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();
const STORAGE_KEY = 'blob.web.outbox.v1';

const sampleEntry: LocalOutboxEntry = {
  clientMsgId: 'msg-1',
  channelId: 'chan-1',
  threadRootId: null,
  body: 'Queued hello',
  attachmentIds: [],
  createdAt: '2026-08-20T12:00:00.000Z',
  status: 'queued',
  attempts: 1,
  lastError: null,
};

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
  });
  storage.clear();
});

afterEach(() => {
  storage.clear();
});

describe('outbox persistence', () => {
  it('stores and reloads queued entries', () => {
    persistOutbox({ [sampleEntry.clientMsgId]: sampleEntry });

    expect(storage.getItem(STORAGE_KEY)).toContain(sampleEntry.clientMsgId);
    expect(loadOutbox()).toEqual({ [sampleEntry.clientMsgId]: sampleEntry });
  });

  it('drops invalid persisted payloads', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify({ broken: { nope: true } }));

    expect(loadOutbox()).toEqual({});
  });

  // One bad entry discards the whole outbox, so an entry written before attachments
  // existed has to keep validating — otherwise shipping this drops queued messages.
  it('adopts entries written before attachments existed', () => {
    const legacy = { ...sampleEntry } as Partial<LocalOutboxEntry>;
    delete legacy.attachmentIds;
    storage.setItem(STORAGE_KEY, JSON.stringify({ [sampleEntry.clientMsgId]: legacy }));

    expect(loadOutbox()).toEqual({ [sampleEntry.clientMsgId]: sampleEntry });
  });

  it('keeps attachment ids through a round trip', () => {
    const withFiles = { ...sampleEntry, attachmentIds: ['att-1', 'att-2'] };
    persistOutbox({ [withFiles.clientMsgId]: withFiles });

    expect(loadOutbox()[withFiles.clientMsgId]?.attachmentIds).toEqual(['att-1', 'att-2']);
  });

  it('rejects attachment ids that are not strings', () => {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ [sampleEntry.clientMsgId]: { ...sampleEntry, attachmentIds: [7] } }),
    );

    expect(loadOutbox()).toEqual({});
  });

  it('removes storage when the outbox becomes empty', () => {
    persistOutbox({ [sampleEntry.clientMsgId]: sampleEntry });
    persistOutbox({});

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('outbox message materialization', () => {
  it('projects an outbox entry into a pending message shape', () => {
    expect(materializeOutboxMessage(sampleEntry, 'user-1')).toEqual({
      id: 'pending-2026-08-20T12:00:00.000Z-msg-1',
      channelId: 'chan-1',
      authorId: 'user-1',
      kind: 'user',
      body: 'Queued hello',
      threadRootId: null,
      alsoInChannel: false,
      replyCount: 0,
      replyUserIds: [],
      lastReplyAt: null,
      mentionUserIds: [],
      mentionGroupIds: [],
      mentionsEveryone: false,
      clientMsgId: 'msg-1',
      editedAt: null,
      deletedAt: null,
      pinnedAt: null,
      createdAt: '2026-08-20T12:00:00.000Z',
      reactions: [],
      attachments: [],
      linkPreview: null,
    });
  });

  it('gives queued messages ids that sort in the order they were written', () => {
    // The store keeps a channel sorted by id and inserts by string comparison, which
    // works because real ids are UUIDv7. A pending id has to hold that up too, and
    // `pending-${clientMsgId}` did not: the client id is a v4 from `crypto.randomUUID`,
    // so two messages typed while offline sorted by a coin flip. Backwards about half
    // the time, and always disagreeing with the order they would be sent in.
    const written = ['09:00', '09:01', '09:02'].map((time, index) => ({
      ...sampleEntry,
      // Deliberately descending, and deliberately the kind of id randomUUID makes:
      // sorting on this alone reverses them.
      clientMsgId: `zz-${3 - index}`,
      createdAt: `2026-08-20T${time}:00.000Z`,
    }));

    const ids = written.map((entry) => materializeOutboxMessage(entry, 'user-1').id);

    expect([...ids].sort()).toEqual(ids);
  });

  it('keeps a queued message below everything already sent', () => {
    // Real ids are hex, and 'p' sorts above 'f', so a pending message lands at the end
    // of the conversation rather than in the middle of it.
    const pending = materializeOutboxMessage(sampleEntry, 'user-1').id;
    const realIdAtTheEndOfTime = 'ffffffff-ffff-7fff-bfff-ffffffffffff';

    expect(pending > realIdAtTheEndOfTime).toBe(true);
  });
});

describe('recoverable send errors', () => {
  it('treats transient failures as recoverable', () => {
    expect(isRecoverableSendError(new Error('socket closed'))).toBe(true);
    expect(isRecoverableSendError(new ApiError(429, 'rate_limited', 'Slow down'))).toBe(true);
    expect(isRecoverableSendError(new ApiError(503, 'unavailable', 'Try later'))).toBe(true);
  });

  it('treats validation failures as non-recoverable', () => {
    expect(isRecoverableSendError(new ApiError(400, 'invalid_input', 'Nope'))).toBe(false);
  });
});
