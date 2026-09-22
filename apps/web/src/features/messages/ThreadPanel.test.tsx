// @vitest-environment happy-dom
/** The thread panel, pinned before it is taken apart.
 *
 * Three things a split must not move: the root and its replies render in order, a
 * summary a model wrote is marked as one (and the keyword scan is not), and the follow
 * toggle reflects the server's answer and flips it.
 *
 * And a fourth, since: closing the thread starts an exit instead of taking the panel
 * away, which the slot around it is what holds.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FALLBACK_MS } from '../../lib/usePresence.ts';

const getThreadSummary = vi.fn();
const listThreadTasks = vi.fn();
const threadFollowing = vi.fn();
const followThread = vi.fn();
const markThreadRead = vi.fn();

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      agentic: { ...actual.api.agentic, getThreadSummary, listThreadTasks },
      messages: { ...actual.api.messages, threadFollowing, followThread, markThreadRead },
    },
  };
});

vi.mock('../../lib/socket.ts', () => ({
  socket: {
    send: vi.fn(),
    sendControl: vi.fn(),
    connect: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    onStatus: vi.fn(() => vi.fn()),
  },
}));

// happy-dom under this Node has no localStorage of its own; the panel only uses it to
// remember whether the tools are open, so a Map stands in.
if (!('localStorage' in globalThis) || !globalThis.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
    configurable: true,
  });
}

const { ThreadPanel, ThreadPanelSlot } = await import('./ThreadPanel.tsx');
const { useStore } = await import('../../lib/store.ts');

function msg(id: string, body: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    channelId: 'c1',
    authorId: 'u1',
    body,
    kind: 'user',
    createdAt: '2026-09-09T10:00:00.000Z',
    threadRootId: null,
    alsoInChannel: false,
    replyCount: 0,
    replyUserIds: [],
    lastReplyAt: null,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    mentionsEveryone: false,
    clientMsgId: null,
    deletedAt: null,
    editedAt: null,
    pinnedAt: null,
    linkPreview: null,
    ...overrides,
  };
}

function summary(provider: string) {
  return {
    id: 's1',
    threadRootId: 'm1',
    provider,
    overview: 'They agreed on the deck.',
    decisions: [{ text: 'Ship Tuesday', messageId: 'm2' }],
    actionItems: [],
    openQuestions: [],
    messageCount: 3,
    updatedAt: '2026-09-09T11:00:00.000Z',
  };
}

function seed() {
  useStore.setState({
    currentUser: {
      id: 'u1',
      kind: 'human',
      displayName: 'Ana',
      role: 'owner',
      prefs: { enterToSend: true },
    },
    users: {
      u1: { id: 'u1', kind: 'human', displayName: 'Ana', deactivated: false },
      u2: { id: 'u2', kind: 'human', displayName: 'Bo', deactivated: false },
    },
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general', memberIds: ['u1', 'u2'], membership: {} },
    },
    threads: {
      m1: [
        msg('m1', 'the root', { replyCount: 2 }),
        msg('m2', 'first reply', { authorId: 'u2', threadRootId: 'm1' }),
        msg('m3', 'second reply', { threadRootId: 'm1' }),
      ],
    },
    agentRuns: {},
    commands: [],
    drafts: {},
    customEmoji: [],
  } as never);
}

// happy-dom does no layout, and the list inside the panel is virtualized: without a
// viewport height it renders nothing. The same stubs `MessageList.test.tsx` uses.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('message-list') ? 800 : 40;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 600 });
  HTMLElement.prototype.getBoundingClientRect = function () {
    const height = this.classList.contains('message-list') ? 800 : 40;
    return { x: 0, y: 0, width: 600, height, top: 0, left: 0, bottom: height, right: 600, toJSON: () => ({}) };
  };
});

/** Past usePresence's fallback, which is what ends an exit here: happy-dom runs no
 *  animations, so the `animationend` a browser would send never comes. */
const EXIT_SETTLED_MS = FALLBACK_MS + 100;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('blob.threadTools', 'open');
  listThreadTasks.mockResolvedValue({ tasks: [] });
  threadFollowing.mockResolvedValue({ following: false });
  followThread.mockResolvedValue({ ok: true });
  markThreadRead.mockResolvedValue({ ok: true });
  seed();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function renderPanel() {
  render(<ThreadPanel rootId="m1" />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe('the thread itself', () => {
  it('shows the root and its replies, in order, with the reply count', async () => {
    getThreadSummary.mockResolvedValue({ summary: null });
    await renderPanel();

    const bodies = Array.from(document.querySelectorAll('.message-body')).map(
      (node) => node.textContent,
    );
    expect(bodies).toEqual(['the root', 'first reply', 'second reply']);
    expect(screen.getByText(/2 replies/)).toBeTruthy();
    expect(screen.getByPlaceholderText('Reply in thread')).toBeTruthy();
  });

  /**
   * The count in the header ticks for a reply arriving, and for nothing else. The panel
   * is not keyed by its thread — it keeps its DOM across a switch — so opening another
   * thread is the same count component being handed a different number, which is not a
   * reply arriving and must not tick like one.
   */
  it('ticks the reply count when a reply lands, and not when another thread opens', async () => {
    getThreadSummary.mockResolvedValue({ summary: null });
    useStore.setState((s) => ({
      threads: {
        ...s.threads,
        m9: [
          msg('m9', 'another root', { replyCount: 1 }),
          msg('m10', 'its only reply', { threadRootId: 'm9' }),
        ] as never,
      },
    }));
    const { rerender } = render(<ThreadPanel rootId="m1" />);
    await act(async () => {
      await Promise.resolve();
    });
    const count = () => document.querySelector<HTMLElement>('.panel-sub-count')!;
    expect(count().textContent).toBe('2 replies');
    expect(count().dataset.changed).toBeUndefined();

    rerender(<ThreadPanel rootId="m9" />);
    expect(count().textContent).toBe('1 reply');
    expect(count().dataset.changed).toBeUndefined();

    act(() => {
      useStore.setState((s) => ({
        threads: {
          ...s.threads,
          m9: [...(s.threads.m9 ?? []), msg('m11', 'a new reply', { threadRootId: 'm9' })] as never,
        },
      }));
    });
    expect(count().textContent).toBe('2 replies');
    expect(count().dataset.changed).toBe('true');
  });
});

describe('the summary card', () => {
  it('marks a summary a model wrote as one', async () => {
    getThreadSummary.mockResolvedValue({ summary: summary('llm:deepseek-chat') });
    await renderPanel();

    const card = document.querySelector('[aria-labelledby="thread-summary-title"]');
    expect(card?.getAttribute('data-written-by')).toBe('model');
    expect(screen.getByText('AI summary')).toBeTruthy();
    expect(screen.getByText(/AI summary · deepseek-chat/)).toBeTruthy();
    expect(screen.getByText(/check the sources/)).toBeTruthy();
  });

  it('does not dress the keyword scan up as an agent', async () => {
    getThreadSummary.mockResolvedValue({ summary: summary('heuristic-v1') });
    await renderPanel();

    const card = document.querySelector('[aria-labelledby="thread-summary-title"]');
    expect(card?.getAttribute('data-written-by')).toBeNull();
    expect(screen.getByText('Summary')).toBeTruthy();
    expect(screen.getByText(/Keyword scan/)).toBeTruthy();
  });
});

describe('closing the panel', () => {
  async function renderSlot(rootId: string) {
    const view = render(<ThreadPanelSlot rootId={rootId} />);
    await act(async () => {
      await Promise.resolve();
    });
    return view;
  }

  it('draws nothing, and claims no column, when there is no thread', async () => {
    // The shell derives its third grid column from this report, so a slot that mounts
    // closed — which is what a view that is not a conversation leaves behind — must
    // never once say it is present. A frame of that is 380px of the incoming view.
    getThreadSummary.mockResolvedValue({ summary: null });
    const onPresence = vi.fn();
    const { unmount } = render(<ThreadPanelSlot rootId={null} onPresence={onPresence} />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(document.querySelector('.panel')).toBeNull();
    expect(onPresence).not.toHaveBeenCalledWith(true);
    expect(onPresence).toHaveBeenCalledWith(false);

    // And it lets go on the way out, rather than leaving the shell holding a column for
    // a panel that is not in the document any more.
    unmount();
    expect(onPresence).not.toHaveBeenCalledWith(true);
    expect(onPresence.mock.calls.at(-1)).toEqual([false]);
  });

  it('marks the panel open while the thread is up', async () => {
    getThreadSummary.mockResolvedValue({ summary: null });
    await renderSlot('m1');

    const panel = document.querySelector('.panel')!;
    expect(panel.getAttribute('data-state')).toBe('open');
    expect(panel.hasAttribute('inert')).toBe(false);
  });

  it('holds the panel for its exit, still showing the thread it was closed with', async () => {
    // Both halves of the hold. React drops a node on the render that stops returning it,
    // so the panel used to vanish with nothing left to animate; and the store forgets the
    // root id on the same render, so a panel rendering straight from it would spend its
    // exit as an empty panel — no messages, no reply count, no channel name.
    getThreadSummary.mockResolvedValue({ summary: null });
    const { rerender } = await renderSlot('m1');

    // Fake timers from here, not before: the mocked requests above resolve on their own.
    vi.useFakeTimers();
    rerender(<ThreadPanelSlot rootId={null} />);

    const leaving = document.querySelector('.panel');
    expect(leaving).toBeTruthy();
    expect(leaving!.getAttribute('data-state')).toBe('closed');
    // Out of the tab order and the accessibility tree for the 150ms it is still there:
    // a close button, a follow toggle, a composer and every message link in it, plus the
    // landmark itself, all for a thread that has been closed.
    expect(leaving!.hasAttribute('inert')).toBe(true);
    expect(
      Array.from(document.querySelectorAll('.message-body')).map((node) => node.textContent),
    ).toEqual(['the root', 'first reply', 'second reply']);
    expect(screen.getByText(/2 replies/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(EXIT_SETTLED_MS);
    });

    expect(document.querySelector('.panel')).toBeNull();
  });
});

describe('following', () => {
  it('reflects the answer and flips it', async () => {
    getThreadSummary.mockResolvedValue({ summary: null });
    threadFollowing.mockResolvedValue({ following: true });
    await renderPanel();

    const toggle = screen.getByRole('button', { name: 'Following' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(markThreadRead).toHaveBeenCalledWith('m1');

    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    expect(followThread).toHaveBeenCalledWith('m1', false);
    expect(screen.getByRole('button', { name: 'Follow' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
});
