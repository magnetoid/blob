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

  it('removes storage when the outbox becomes empty', () => {
    persistOutbox({ [sampleEntry.clientMsgId]: sampleEntry });
    persistOutbox({});

    expect(storage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('outbox message materialization', () => {
  it('projects an outbox entry into a pending message shape', () => {
    expect(materializeOutboxMessage(sampleEntry, 'user-1')).toEqual({
      id: 'pending-msg-1',
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
