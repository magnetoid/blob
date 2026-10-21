// @vitest-environment happy-dom
/** Telling the server about drafts, a pause at a time (ADR 0037). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api.ts';
import { connectDraftSync, hasPendingDraftSync, scheduleDraftSync } from './draftSync.ts';
import type { DraftEntry } from './drafts.ts';

let entries: Record<string, DraftEntry> = {};
const settled = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  entries = { 'c1:m9': { body: 'half', updatedAt: 'x', unsynced: true } };
  connectDraftSync((key) => entries[key], settled);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  settled.mockClear();
});

describe('saving drafts', () => {
  it('waits for a pause, then sends the place and the words', async () => {
    const save = vi.spyOn(api.drafts, 'save').mockResolvedValue({ draft: null });
    scheduleDraftSync('c1:m9');
    expect(hasPendingDraftSync('c1:m9')).toBe(true);
    await vi.advanceTimersByTimeAsync(800);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'c1', threadRootId: 'm9', body: 'half' }),
    );
    expect(settled).toHaveBeenCalledWith('c1:m9', 'half');
    expect(hasPendingDraftSync('c1:m9')).toBe(false);
  });

  it('keeps owing a save the network lost', async () => {
    vi.spyOn(api.drafts, 'save').mockRejectedValue(new TypeError('offline'));
    scheduleDraftSync('c1:m9');
    await vi.advanceTimersByTimeAsync(800);
    expect(settled).not.toHaveBeenCalled();
  });

  it('stops asking about a room it may not write in', async () => {
    vi.spyOn(api.drafts, 'save').mockRejectedValue(new ApiError(404, 'not_found', 'gone'));
    scheduleDraftSync('c1:m9');
    await vi.advanceTimersByTimeAsync(800);
    expect(settled).toHaveBeenCalledWith('c1:m9', 'half');
  });
});
