// @vitest-environment happy-dom
/** A message that is a decision's source says so, under its words (M2 · A8). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';
import * as router from '../../lib/router.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const message = (decisionId: string | null): Message =>
  ({
    id: '01a05000-0000-7000-8000-000000000001',
    channelId: 'c1',
    authorId: 'u1',
    body: 'We ship on Friday.',
    kind: 'user',
    createdAt: '2026-10-20T09:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
    decisionId,
  }) as unknown as Message;

function show(decisionId: string | null) {
  useStore.setState({
    users: { u1: { id: 'u1', displayName: 'Ana' } },
    currentUser: { id: 'u1', displayName: 'Ana', prefs: { language: null, autoTranslate: false } },
    customEmoji: [],
    myGroupIds: new Set(),
    savedMessageIds: new Set(),
    editingMessageId: null,
    messageDeliveryState: () => null,
  } as never);
  return render(<MessageRow message={message(decisionId)} previous={null} onOpenThread={vi.fn()} />);
}

describe('a decision under its message', () => {
  it('is marked, and the mark opens the log', () => {
    const go = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    show('d1');
    fireEvent.click(screen.getByRole('button', { name: 'Decision' }));
    expect(go).toHaveBeenCalledWith('/decisions');
  });

  it('is not marked when it is not one', () => {
    show(null);
    expect(screen.queryByRole('button', { name: 'Decision' })).toBeNull();
  });
});
