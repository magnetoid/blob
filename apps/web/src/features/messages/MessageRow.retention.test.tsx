// @vitest-environment happy-dom
/**
 * A message whose files the workspace's retention took keeps its words and says the files
 * went (ADR 0039) — rather than a message that mentions an attachment nobody can see.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageRow } from './MessageRow.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const message = (filesRemoved: number): Message =>
  ({
    id: '01a05000-0000-7000-8000-00000000f11e',
    channelId: 'c1',
    authorId: 'u-them',
    body: 'the diagram is attached',
    kind: 'user',
    createdAt: '2025-08-31T09:00:00.000Z',
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
    linkPreview: null,
    filesRemoved,
  }) as unknown as Message;

function show(filesRemoved: number) {
  useStore.setState({
    users: {},
    currentUser: { id: 'u-me', displayName: 'Me', prefs: {} },
    customEmoji: [],
    myGroupIds: new Set(),
    savedMessageIds: new Set(),
    editingMessageId: null,
    messageDeliveryState: () => null,
  } as never);
  render(<MessageRow message={message(filesRemoved)} previous={null} onOpenThread={vi.fn()} />);
}

describe('files retention took', () => {
  it('are said to have gone, under the words that stayed', () => {
    show(2);
    expect(screen.getByText('the diagram is attached')).toBeTruthy();
    expect(screen.getByText('2 files were removed by this workspace’s retention.')).toBeTruthy();
  });

  it('are one file in the singular', () => {
    show(1);
    expect(screen.getByText('A file was removed by this workspace’s retention.')).toBeTruthy();
  });

  it('say nothing when none went', () => {
    show(0);
    expect(screen.queryByText(/removed by this workspace/)).toBeNull();
  });
});
