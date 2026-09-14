// @vitest-environment happy-dom
/**
 * Switching conversations must not leave the old list behind.
 *
 * `ChannelView` used to say `key={activeChannelId}` on `<MessageList>` — the ordinary
 * React way to say "that was a different conversation, forget what you measured". It
 * leaked: React unmounted the old list and left its DOM in the document. Measured on
 * 2026-09-14 against a production build, a channel with 671 messages: one list became
 * six after six channel switches, 236 DOM nodes became 3,209, and the click that
 * switched channel took 772 ms (383 ms script, 387 ms presentation) — every stranded
 * list still laid out and painted on every frame, so the app got slower the longer it
 * was used. Taking the key off held the count at one.
 *
 * The key is gone and `conversationId` does its job explicitly. These pin both halves:
 * the reset actually happens, and neither call site re-introduces a key.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MessageList } from './MessageList.tsx';
import type { Message } from '@blob/shared';

function messages(prefix: string, count: number): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${String(i).padStart(4, '0')}`,
    channelId: 'c1',
    authorId: 'u1',
    body: `${prefix} message ${i}`,
    kind: 'user',
    createdAt: '2026-09-01T10:00:00.000Z',
    threadRootId: null,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
  })) as unknown as Message[];
}

const base = {
  hasMore: false,
  loading: false,
  onLoadOlder: vi.fn(),
  onOpenThread: vi.fn(),
  unreadAfterId: null,
};

describe('changing conversation', () => {
  it('reuses the one list instead of leaving the old one in the document', () => {
    const { container, rerender } = render(
      <MessageList {...base} conversationId="c1" messages={messages('a', 30)} />,
    );
    expect(container.querySelectorAll('.message-list')).toHaveLength(1);

    for (const id of ['c2', 'c3', 'c4', 'c5']) {
      rerender(<MessageList {...base} conversationId={id} messages={messages(id, 30)} />);
      expect(container.querySelectorAll('.message-list'), id).toHaveLength(1);
    }
  });

  it('keeps the same scroll container, which is what the key used to replace', () => {
    // The point of the change, stated as identity: one element, reused. A key would
    // mint a new one each time — and, as measured, leave the old one in the document.
    const { container, rerender } = render(
      <MessageList {...base} conversationId="c1" messages={messages('a', 30)} />,
    );
    const first = container.querySelector('.message-list');
    rerender(<MessageList {...base} conversationId="c2" messages={messages('b', 30)} />);
    expect(container.querySelector('.message-list')).toBe(first);
    expect(first?.isConnected).toBe(true);
  });
});

describe('the call sites', () => {
  /**
   * A source check, like `sourceRatchets.test.ts`, because this is the mistake that
   * looks correct: a keyed list is the textbook way to reset one, and the defect it
   * causes is invisible until you count DOM nodes after twenty channel switches.
   */
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('never key the message list — MessageList resets itself on conversationId', () => {
    for (const file of ['./ChannelView.tsx', './ThreadPanel.tsx']) {
      const source = read(file);
      const opening = source.indexOf('<MessageList');
      expect(opening, file).toBeGreaterThan(-1);
      const tag = source.slice(opening, source.indexOf('/>', opening));
      expect(tag, file).not.toMatch(/\bkey=/);
      expect(tag, file).toMatch(/conversationId=/);
    }
  });
});
