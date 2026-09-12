// @vitest-environment happy-dom
/** The thread panel, pinned before it is taken apart.
 *
 * Three things a split must not move: the root and its replies render in order, a
 * summary a model wrote is marked as one (and the keyword scan is not), and the follow
 * toggle reflects the server's answer and flips it.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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

const { ThreadPanel } = await import('./ThreadPanel.tsx');
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('blob.threadTools', 'open');
  listThreadTasks.mockResolvedValue({ tasks: [] });
  threadFollowing.mockResolvedValue({ following: false });
  followThread.mockResolvedValue({ ok: true });
  markThreadRead.mockResolvedValue({ ok: true });
  seed();
});
afterEach(cleanup);

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
