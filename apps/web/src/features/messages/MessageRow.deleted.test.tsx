// @vitest-environment happy-dom
/**
 * A deleted message is still a row, and still holds its thread.
 *
 * The tombstone was a bare `<div>` among `<article>` siblings, with no `data-message-id`
 * and no reply count. Two things followed. Arrows and jumps walk `[data-message-id]`, so
 * the row was a hole in the list — stepped over, and unreachable from a permalink or a
 * pin. And deleting the first message of a thread made its replies unreachable from the
 * channel entirely, though `replyCount` was in the payload the whole time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const deleted = (replyCount: number): Message =>
  ({
    id: '01a05000-0000-7000-8000-00000000dead',
    channelId: 'c1',
    authorId: 'u-them',
    body: '',
    kind: 'user',
    createdAt: '2026-08-31T09:00:00.000Z',
    editedAt: null,
    deletedAt: '2026-08-31T10:00:00.000Z',
    threadRootId: null,
    replyCount,
    replyUserIds: [],
    lastReplyAt: null,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
  }) as unknown as Message;

function show(replyCount: number, onOpenThread = vi.fn()) {
  useStore.setState({
    users: {},
    currentUser: { id: 'u-me', displayName: 'Me', prefs: {} },
    customEmoji: [],
    myGroupIds: new Set(),
    savedMessageIds: new Set(),
    editingMessageId: null,
    messageDeliveryState: () => null,
  } as never);
  const view = render(
    <MessageRow message={deleted(replyCount)} previous={null} onOpenThread={onOpenThread} />,
  );
  return { ...view, onOpenThread };
}

describe('a deleted message', () => {
  it('says so', () => {
    show(0);
    expect(screen.getByText('This message was deleted')).toBeTruthy();
  });

  it('is a row the list can find, not a hole in it', () => {
    // `[data-message-id]` is what arrow navigation walks and what a jump scrolls to.
    const { container } = show(0);
    const row = container.querySelector('[data-message-id]');

    expect(row).toBeTruthy();
    expect(row!.tagName).toBe('ARTICLE');
  });

  it('keeps the thread that hung from it', () => {
    const { onOpenThread } = show(2);
    const summary = screen.getByRole('button', { name: /2 replies/ });

    fireEvent.click(summary);

    expect(onOpenThread).toHaveBeenCalled();
  });

  it('offers no thread when there was none', () => {
    show(0);
    expect(screen.queryByRole('button', { name: /repl/ })).toBeNull();
  });
});
