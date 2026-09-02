// @vitest-environment happy-dom
/** A search that has been overtaken.
 *
 * The debounce only spaces requests out; it never stopped an earlier one landing last.
 * And the earlier one is systematically the slower of the two — the count is computed
 * over the whole match set, so the shorter, broader term is the more expensive query.
 *
 * The result was a list, a "showing N of M" count and a "show more" cursor that all
 * belonged to a search the box no longer showed. The failure case was worse: a 429 from
 * the abandoned query wiped results that had already arrived and worked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const search = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { search: (...args: unknown[]) => search(...(args as [])) } };
});

vi.mock('../../lib/navigation.ts', () => ({ showMessage: vi.fn() }));

const { SearchView } = await import('./SearchView.tsx');

function message(id: string, body: string) {
  return {
    id,
    channelId: 'c1',
    authorId: 'u1',
    body,
    createdAt: '2026-09-01T09:00:00.000Z',
    kind: 'user',
    reactions: [],
    attachments: [],
  };
}

/** A promise somebody else decides the fate of. */
function deferred<T>() {
  let settle!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  search.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function type(term: string) {
  fireEvent.change(screen.getByLabelText('Search messages'), { target: { value: term } });
  await act(async () => {
    vi.advanceTimersByTime(250);
  });
}

describe('a search that has been overtaken', () => {
  it('ignores the older response when a newer one has already painted', async () => {
    const slow = deferred<unknown>();
    search.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({
      messages: [message('m2', 'the newer answer')],
      total: 1,
      nextCursor: null,
    });

    render(<SearchView />);
    await type('a');
    await type('abc');

    await act(async () => {
      slow.settle({
        messages: [message('m1', 'the older answer')],
        total: 99,
        nextCursor: 'stale-cursor',
      });
      await Promise.resolve();
    });

    expect(screen.queryByText('the older answer')).toBeNull();
    expect(screen.getByText('the newer answer')).toBeTruthy();
  });

  it('does not report an older failure over results that worked', async () => {
    const slow = deferred<unknown>();
    search.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({
      messages: [message('m2', 'the newer answer')],
      total: 1,
      nextCursor: null,
    });

    render(<SearchView />);
    await type('a');
    await type('abc');

    await act(async () => {
      slow.fail(new Error('too slow'));
      await Promise.resolve();
    });

    expect(screen.getByText('the newer answer')).toBeTruthy();
  });

  it('paints nothing for a search the box no longer holds', async () => {
    // The easiest reproduction, and it needs no second request: type, wait past the
    // debounce, then clear the field. The empty branch resets the view — and then the
    // in-flight response used to land underneath an empty search box.
    const slow = deferred<unknown>();
    search.mockReturnValueOnce(slow.promise);

    render(<SearchView />);
    await type('a');
    await type('');

    await act(async () => {
      slow.settle({ messages: [message('m1', 'orphaned')], total: 1, nextCursor: null });
      await Promise.resolve();
    });

    expect(screen.queryByText('orphaned')).toBeNull();
  });
});
