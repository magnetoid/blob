// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageMenu } from './MessageMenu.tsx';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

const MESSAGE = {
  id: '01a05000-0000-7000-8000-000000000001',
  channelId: 'c1',
  authorId: 'u1',
  body: 'hello',
  kind: 'user',
  createdAt: '2026-08-31T09:00:00.000Z',
  editedAt: null,
  deletedAt: null,
  threadRootId: null,
  replyCount: 0,
  reactions: [],
  attachments: [],
} as unknown as Message;

function open() {
  useStore.setState({ savedMessageIds: new Set(), activeThreadRootId: null } as never);
  const view = render(
    <MessageMenu
      message={MESSAGE}
      mine
      onCopyLink={vi.fn()}
      onForward={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText('More actions'));
  return view;
}

/**
 * It was the one menu in the app that could not be closed. It reused the composer's
 * autocomplete popover with an inline style object, so it had no role, no Escape, no
 * outside-click dismissal and no arrow keys — once opened, the only way out was to pick
 * something or click a control that happened to re-render the row.
 */
describe('the message ••• menu', () => {
  it('opens as a menu, with menu items in it', () => {
    const { container } = open();

    const panel = container.querySelector('.message-menu');
    expect(panel).toBeTruthy();
    expect(panel?.getAttribute('role')).toBe('menu');
    expect(panel?.querySelectorAll('[role="menuitem"]').length).toBeGreaterThan(0);
  });

  it('says what the trigger opens', () => {
    open();
    const trigger = screen.getByLabelText('More actions');

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  // Closing has two halves now that the panel animates away: it stops being a menu
  // at once — inert, and marked closed for CSS to run the exit off — and leaves the
  // DOM when that exit ends. Asserting only the second would pass on a panel that
  // was still clickable on its way out.
  it('closes on Escape', async () => {
    const { container } = open();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(container.querySelector('.message-menu')?.getAttribute('data-state')).toBe('closed');
    await waitFor(() => expect(container.querySelector('.message-menu')).toBeNull());
  });

  it('closes on a click outside it', async () => {
    const { container } = open();

    // Capture phase, on window — the house dismissal contract.
    fireEvent.click(document.body);

    expect(container.querySelector('.message-menu')?.getAttribute('data-state')).toBe('closed');
    await waitFor(() => expect(container.querySelector('.message-menu')).toBeNull());
  });

  it('moves focus onto an item with the arrow keys', () => {
    open();

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
  });
});
