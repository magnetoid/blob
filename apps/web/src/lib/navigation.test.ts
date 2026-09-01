// @vitest-environment happy-dom
/** Following a permalink.
 *
 * The order is the whole thing, and it is forced by three separate facts. The link
 * carries an id and nothing else, so the message has to be fetched before anything can
 * be opened. A link worth sending is usually to something old, so the channel is loaded
 * *around* the target rather than at its newest page. And the thread panel renders
 * beside the conversation, so a thread cannot be opened before its channel.
 *
 * The reply case is the one that would break quietly: `history` filters
 * `thread_root_id IS NULL` in all three of its modes, so a reply is never in channel
 * history. Centring the channel on the reply's own id would fetch a window that does
 * not contain it and land nowhere, with nothing failing.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@blob/shared';

const calls: string[] = [];

const getMessage = vi.fn(async () => ({ message: {} as Message }));
const openChannel = vi.fn(async (id: string, around?: string) => {
  calls.push(`channel:${id}${around ? `@${around}` : ''}`);
});
const openThread = vi.fn(async (id: string) => {
  calls.push(`thread:${id}`);
});
const navigate = vi.fn((path: string) => calls.push(`navigate:${path}`));
const requestScrollToMessage = vi.fn((id: string | null) => calls.push(`request:${id}`));

vi.mock('./api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api.ts')>();
  return {
    ...actual,
    api: { ...actual.api, messages: { ...actual.api.messages, get: () => getMessage() } },
  };
});

vi.mock('./router.ts', () => ({
  navigate: (p: string) => navigate(p),
  pathForChannel: (channelId: string, threadRootId?: string) =>
    threadRootId ? `/c/${channelId}/t/${threadRootId}` : `/c/${channelId}`,
}));

vi.mock('./store.ts', () => ({
  useStore: { getState: () => ({ openChannel, openThread, requestScrollToMessage }) },
}));

const { flashMessage, permalinkFor, scrollToMessage, showMessage } = await import(
  './navigation.ts'
);

function message(overrides: Partial<Message> = {}): Message {
  return { id: 'm1', channelId: 'c1', threadRootId: null, ...overrides } as Message;
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  document.body.innerHTML = '';
});

describe('permalinkFor', () => {
  it('is an absolute URL, because it is going into somebody else s message', () => {
    // A path alone would be useless the moment it left this tab.
    expect(permalinkFor('m1')).toBe(`${window.location.origin}/m/m1`);
  });
});

describe('scrollToMessage', () => {
  it('finds a row by attribute, not by id', () => {
    // The same message renders in the list and in a thread at once; duplicate ids would
    // make whichever came first win at random.
    document.body.innerHTML = '<div data-message-id="m1"></div>';
    const node = document.querySelector('[data-message-id="m1"]') as HTMLElement;
    node.scrollIntoView = vi.fn();

    expect(scrollToMessage('m1')).toBe(true);
    expect(node.classList.contains('message-flash')).toBe(true);
  });

  it('says so when the row is not rendered', () => {
    // The caller uses this to tell "not committed yet" from "not here at all".
    expect(scrollToMessage('missing')).toBe(false);
  });
});

describe('showMessage', () => {
  it('centres the channel on the message, then goes there', async () => {
    getMessage.mockResolvedValueOnce({ message: message() });
    await showMessage('m1');

    expect(calls).toEqual(['channel:c1@m1', 'navigate:/c/c1', 'request:m1']);
  });

  it('centres on the thread root for a reply, and opens the thread after the channel', async () => {
    getMessage.mockResolvedValueOnce({ message: message({ id: 'r1', threadRootId: 'm1' }) });
    await showMessage('r1');

    // Around the *root*: the reply is not in channel history at all, so asking for a
    // window around it would centre on an id the query cannot see.
    expect(calls).toEqual([
      'channel:c1@m1',
      'thread:m1',
      'navigate:/c/c1/t/m1',
      'request:r1',
    ]);
  });

  it('hands the jump to the list instead of hunting for an element', async () => {
    getMessage.mockResolvedValueOnce({ message: message() });
    // Nothing is rendered here, and that used to be the whole problem: `showMessage`
    // looked the row up in the DOM and gave up after two frames. In a virtualized list
    // the row is absent until something scrolls to its index, so the target is recorded
    // and the list that holds it does the scrolling.
    await expect(showMessage('m1')).resolves.toBe(true);
    expect(requestScrollToMessage).toHaveBeenCalledWith('m1');
  });
});

describe('flashMessage', () => {
  it('marks a row that is on screen', () => {
    document.body.innerHTML = '<article data-message-id="m1"></article>';
    flashMessage('m1');
    expect(document.querySelector('[data-message-id="m1"]')!.className).toContain(
      'message-flash',
    );
  });

  it('does nothing for a row that is not rendered', () => {
    // The virtualized case. It must not throw: the list calls this a frame after asking
    // the virtualizer to scroll, and a row can still be missing if the list changed.
    expect(() => flashMessage('nope')).not.toThrow();
  });
});
