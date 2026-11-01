// @vitest-environment happy-dom
/**
 * One Escape closes one layer: a person card open in the conversation, then Escape.
 *
 * The shell answers Escape on `window` — it closes the thread panel, and Shift+Escape marks
 * everything read — so a card that closed itself on the key and let it go on would close
 * the thread behind it too. The card is on `lib/useEscape`'s stack while it is open, which
 * takes the key in the capture phase and stops it there; the shell, listening in the
 * bubble phase like `app/Workspace.tsx`, never hears it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@blob/shared';
import '../../test/overlayChunk.ts';

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return {
    ...actual,
    api: { ...actual.api, users: { ...actual.api.users, get: vi.fn(() => new Promise(() => {})) } },
  };
});

const { MessageRow } = await import('./MessageRow.tsx');
const { useStore } = await import('../../lib/store.ts');

afterEach(cleanup);

const ME = 'u-me';
const THEM = 'u-them';

const message = {
  id: '01a05000-0000-7000-8000-000000000001',
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
} as unknown as Message;

describe('a person card in the conversation', () => {
  it('closes on one Escape, and nothing behind it hears the key', async () => {
    useStore.setState({
      users: {
        [ME]: { id: ME, displayName: 'Me' },
        [THEM]: { id: THEM, kind: 'human', displayName: 'Them' },
      },
      currentUser: { id: ME, displayName: 'Me', prefs: { language: null, autoTranslate: false } },
      customEmoji: [],
      myGroupIds: new Set(),
      savedMessageIds: new Set(),
      editingMessageId: null,
      messageDeliveryState: () => null,
    } as never);
    // The shell's own listener, where `Workspace` puts it: closing the thread panel on
    // Escape, marking everything read on Shift+Escape.
    const shell = vi.fn();
    window.addEventListener('keydown', shell);
    render(<MessageRow message={message} previous={null} onOpenThread={vi.fn()} />);
    const name = screen.getByRole('button', { name: 'Them' });
    name.focus();

    fireEvent.click(name);
    const card = screen.getByRole('dialog', { name: 'Them' });
    await waitFor(() => expect(card.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    expect(card).toHaveProperty('inert', true);
    expect(shell).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(name);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // And the next Escape, with nothing open, is the shell's again.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(shell).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', shell);
  });
});
