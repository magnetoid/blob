// @vitest-environment happy-dom
/**
 * Save-for-later has to live on the hover bar, not only in •••.
 *
 * The menu already toggles it. The reserved bookmark slot on the row never shipped,
 * so the gesture every chat app trains — hover, pin — still required opening a menu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const ME = 'u-me';
const THEM = 'u-them';
const ID = '01a05000-0000-7000-8000-000000000001';

const message = (): Message =>
  ({
    id: ID,
    channelId: 'c1',
    authorId: THEM,
    body: 'hello',
    kind: 'user',
    createdAt: '2026-08-31T09:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    threadRootId: null,
    replyCount: 0,
    reactions: [],
    attachments: [],
    mentionUserIds: [],
    mentionGroupIds: [],
  }) as unknown as Message;

function show(saved: boolean, toggleSaved = vi.fn().mockResolvedValue(undefined)) {
  useStore.setState({
    users: {
      [ME]: { id: ME, displayName: 'Me' },
      [THEM]: { id: THEM, displayName: 'Them' },
    },
    currentUser: {
      id: ME,
      displayName: 'Me',
      prefs: { language: null, autoTranslate: false },
    },
    customEmoji: [],
    myGroupIds: new Set(),
    savedMessageIds: saved ? new Set([ID]) : new Set(),
    toggleSaved,
    editingMessageId: null,
    messageDeliveryState: () => null,
  } as never);
  render(<MessageRow message={message()} previous={null} onOpenThread={vi.fn()} />);
  return toggleSaved;
}

describe('save on the hover bar', () => {
  it('is a pressed bookmark when the message is already in Later', () => {
    show(true);
    const btn = screen.getByRole('button', { name: 'Remove from later' });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('toggles Later without opening the menu', () => {
    const toggleSaved = show(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save for later' }));
    expect(toggleSaved).toHaveBeenCalledWith(ID);
  });
});
