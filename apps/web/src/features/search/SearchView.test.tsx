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
const listFiles = vi.fn();
const navigate = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      search: (...args: unknown[]) => search(...(args as [])),
      files: { list: (...args: unknown[]) => listFiles(...(args as [])) },
    },
  };
});

vi.mock('../../lib/navigation.ts', () => ({
  showMessage: vi.fn(),
  showChannelFromResult: vi.fn(),
  showDirectMessage: vi.fn(),
}));

vi.mock('../../lib/router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/router.ts')>();
  return { ...actual, navigate };
});

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
  listFiles.mockReset();
  navigate.mockReset();
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

describe('the parsed query echo', () => {
  it('shows the modifiers the server read, even with no leftover words', async () => {
    search.mockResolvedValue({
      messages: [message('m1', 'hello from ana')],
      total: 1,
      nextCursor: null,
      parsed: {
        text: '',
        from: 'ana',
        in: null,
        has: null,
        before: null,
        after: null,
      },
    });

    render(<SearchView />);
    await type('from:@ana');

    expect(screen.getByLabelText('Parsed query').textContent).toContain('from:@ana');
    expect(screen.getByText('hello from ana')).toBeTruthy();
  });

  it('marks the leftover words in the result body', async () => {
    search.mockResolvedValue({
      messages: [message('m1', 'please deploy now')],
      total: 1,
      nextCursor: null,
      parsed: {
        text: 'deploy',
        from: null,
        in: null,
        has: null,
        before: null,
        after: null,
      },
    });

    render(<SearchView />);
    await type('deploy');

    expect(document.querySelector('mark.search-hit')?.textContent).toBe('deploy');
  });

  it('says which name it could not place instead of a generic miss', async () => {
    search.mockResolvedValue({
      messages: [],
      total: 0,
      nextCursor: null,
      parsed: {
        text: '',
        from: 'nobodyatall',
        in: null,
        has: null,
        before: null,
        after: null,
        unresolved: ['from:nobodyatall'],
      },
    });

    render(<SearchView />);
    await type('from:@nobodyatall');

    expect(screen.getByText('Could not place from:nobodyatall.')).toBeTruthy();
  });
});

describe('search scopes', () => {
  it('searches messages and nothing else by default', async () => {
    search.mockResolvedValue({ messages: [message('m1', 'a result')], total: 1, nextCursor: null });

    render(<SearchView />);
    await type('deploy');

    expect(search).toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('lists filenames when the URL asked for files', async () => {
    listFiles.mockResolvedValue({
      items: [
        {
          id: 'f1',
          filename: 'deploy-runbook.pdf',
          mime: 'application/pdf',
          sizeBytes: 10,
          width: null,
          height: null,
          url: '/api/files/f1',
          thumbUrl: null,
          kind: 'file',
          durationMs: null,
          waveform: null,
          transcriptStatus: 'none',
          transcriptProvider: null,
          channelId: 'c1',
          messageId: 'm9',
          createdAt: '2026-09-01T09:00:00.000Z',
        },
      ],
      nextCursor: null,
    });

    render(<SearchView initialScope="files" />);
    await type('deploy');

    expect(listFiles).toHaveBeenCalledWith({ q: 'deploy' });
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText('deploy-runbook.pdf')).toBeTruthy();
  });

  it('puts the chosen scope in the URL', async () => {
    render(<SearchView />);
    await type('deploy');
    fireEvent.click(screen.getByRole('button', { name: 'Files' }));

    expect(navigate).toHaveBeenCalledWith('/search?q=deploy&scope=files', { replace: true });
  });

  it('keeps the has: filters and the sort on messages only', async () => {
    render(<SearchView initialScope="files" />);
    await type('deploy');

    // `has:link` over a list of filenames is not a narrowing, it is nonsense.
    expect(screen.queryByRole('button', { name: 'Has link' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Sort results' })).toBeNull();
  });
});
