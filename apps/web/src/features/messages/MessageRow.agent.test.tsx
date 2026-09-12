// @vitest-environment happy-dom
/**
 * Telling an agent's message from a person's, at a glance.
 *
 * ADR 0005 makes a bot a real `users` row so that mentions, search and DMs work with no
 * frontend change — which is exactly what makes this necessary. A bot posts through the
 * same path a person does and lands in the list looking like one, and "who wrote this"
 * is the first thing a reader needs, not the last. The Meadow direction answers it with
 * a reserved iris colour and a badge rather than an icon, because a word survives being
 * small, colour-blind, and printed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { Avatar } from '../../components/Avatar.tsx';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

describe('an agent is marked as one', () => {
  it('marks a bot avatar and leaves a person alone', () => {
    const { container } = render(
      <Avatar user={{ displayName: 'Scout', avatarUrl: null, kind: 'bot' }} />,
    );
    expect(container.querySelector('.avatar')?.getAttribute('data-kind')).toBe('bot');

    cleanup();
    const person = render(
      <Avatar user={{ displayName: 'Marko', avatarUrl: null, kind: 'human' }} />,
    );
    expect(person.container.querySelector('.avatar')?.getAttribute('data-kind')).toBe('human');
  });

  it('leaves the kind off when the caller does not know it', () => {
    // Most callers pass a partial user. They must keep working, and must not claim the
    // person is human when nobody said so.
    const { container } = render(<Avatar user={{ displayName: 'Ana', avatarUrl: null }} />);
    expect(container.querySelector('.avatar')?.hasAttribute('data-kind')).toBe(false);
    expect(screen.getByTitle('Ana')).toBeTruthy();
  });
});

describe("an agent's answer is set apart from the conversation", () => {
  const message = (authorId: string): Message =>
    ({
      id: '01a05000-0000-7000-8000-00000000beef',
      channelId: 'c1',
      authorId,
      body: 'The dip is isolated to email verification.',
      kind: authorId === 'b1' ? 'bot' : 'user',
      createdAt: '2026-09-12T09:00:00.000Z',
      editedAt: null,
      deletedAt: null,
      threadRootId: null,
      replyCount: 0,
      replyUserIds: [],
      lastReplyAt: null,
      reactions: [],
      attachments: [],
      mentionUserIds: [],
      mentionGroupIds: [],
    }) as unknown as Message;

  function show(authorId: string) {
    useStore.setState({
      users: {
        u1: { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false },
        b1: { id: 'b1', kind: 'bot', displayName: 'Blob', deactivated: false },
      },
      currentUser: { id: 'u-me', displayName: 'Me', prefs: {} },
      customEmoji: [],
      myGroupIds: new Set(),
      savedMessageIds: new Set(),
      editingMessageId: null,
      messageDeliveryState: () => null,
    } as never);
    return render(
      <MessageRow message={message(authorId)} previous={null} onOpenThread={vi.fn()} />,
    );
  }

  it('puts an agent answer in a card', () => {
    const { container } = show('b1');
    expect(container.querySelector('.message-body')?.getAttribute('data-agent')).toBe('true');
  });

  it('leaves a person’s message as prose', () => {
    // The marking has to mean something, which it stops doing the moment it is on
    // everything.
    const { container } = show('u1');
    expect(container.querySelector('.message-body')?.hasAttribute('data-agent')).toBe(false);
  });
});
