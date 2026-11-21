// @vitest-environment happy-dom
/**
 * A message's More actions, which is shadcn's DropdownMenu (Base UI's) from a module of its
 * own (`lazyPopups.ts`). It was once the one menu in the app that could not be closed — no
 * role, no Escape, no arrows — and what is pinned here is that it is a menu in full, and the
 * three things the move to a portalled menu put at risk: a row scrolled past draws no Base
 * UI root, the toolbar it hangs from stays up while it is open, and a dialog one of its
 * items opened gives focus back to the message rather than to <body>, since the button it
 * was opened from is hidden once the pointer has gone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { MessageMenu } from './MessageMenu.tsx';
import { MessageMenuPopup } from './lazyPopups.ts';
import { MessageRow } from './MessageRow.tsx';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import '../../test/overlayChunk.ts';

// Here before the first test, as it normally is in the app by the time a row is pressed:
// what a press draws is then the press's alone, which is what `mount: 'press'` is about.
await MessageMenuPopup.preload();

const ME = 'u1';

const MESSAGE = {
  id: '01a05000-0000-7000-8000-000000000001',
  channelId: 'c1',
  authorId: ME,
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

function signIn(role: 'owner' | 'admin' | 'member' = 'member') {
  useStore.setState({
    currentUser: { id: ME, displayName: 'Olga', role, prefs: {} },
    savedMessageIds: new Set(),
    activeThreadRootId: null,
  } as never);
}

/** The button as it is now: the press swaps the placeholder for the menu's own trigger. */
const moreActions = () => screen.getByRole('button', { name: 'More actions' });

/** The menu as a row draws it: inside the message's article, which focus can go back to. */
function draw(message: Message = MESSAGE, mine = true) {
  render(
    <article data-message-id={message.id} tabIndex={-1}>
      <MessageMenu
        message={message}
        mine={mine}
        onCopyLink={vi.fn()}
        onForward={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />
    </article>,
  );
  return moreActions();
}

/** Open it by pointer, and wait for Base UI to draw the portal's contents. */
async function open(message: Message = MESSAGE, mine = true) {
  const row = draw(message, mine).closest('article')!;
  fireEvent.click(moreActions());
  const menu = await screen.findByRole('menu');
  return { row, menu };
}

/** A native button's Enter: happy-dom does not turn the key into a click as a browser does. */
function pressEnter(element: HTMLElement) {
  element.focus();
  fireEvent.keyDown(element, { key: 'Enter' });
  fireEvent.click(element, { detail: 0 });
  fireEvent.keyUp(element, { key: 'Enter' });
}

beforeEach(() => signIn());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the message’s More actions', () => {
  it('draws no menu until More actions is pressed', async () => {
    // The module is here, and still a row costs no Base UI root until somebody presses it:
    // a virtualised list mounts rows on every scroll, and most are never pressed.
    const trigger = draw();
    const row = trigger.closest('article')!;
    expect(row.querySelector('[data-slot="dropdown-menu-trigger"]')).toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');

    fireEvent.click(trigger);

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(row.querySelector('[data-slot="dropdown-menu-trigger"]')).toBe(moreActions());
  });

  it('opens from More actions and walks its items with the arrow keys', async () => {
    const trigger = draw();

    pressEnter(trigger);

    const menu = await screen.findByRole('menu');
    expect(moreActions().getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]?.textContent).toBe('Copy link');
    expect(items[1]?.textContent).toBe('Forward…');
    // Opened as it is drawn, the menu takes focus itself; the first arrow reaches the first item.
    await waitFor(() => expect(document.activeElement).toBe(menu));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });

    await waitFor(() => expect(document.activeElement).toBe(items[1]));
  });

  it('marks More actions while open, which the toolbar keys on', async () => {
    // `.message-actions:has([data-popup-open])` keeps the toolbar up once the pointer has
    // left the row for the menu, which is portalled out of it.
    const { menu } = await open();
    expect(moreActions().hasAttribute('data-popup-open')).toBe(true);

    fireEvent.keyDown(document.activeElement ?? menu, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(moreActions().hasAttribute('data-popup-open')).toBe(false);
  });

  it('closes on Escape and gives focus back to More actions', async () => {
    await open();
    const item = screen.getByRole('menuitem', { name: 'Copy link' });
    item.focus();

    fireEvent.keyDown(item, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(moreActions());
  });

  it('offers the reminder presets as a submenu, and one saves a reminder', async () => {
    const update = vi.spyOn(api.later, 'update').mockResolvedValue({} as never);
    await open();
    const remind = screen.getByRole('menuitem', { name: 'Remind me…' });
    expect(remind.getAttribute('aria-haspopup')).toBe('menu');

    remind.focus();
    fireEvent.keyDown(remind, { key: 'ArrowRight' });

    const preset = await screen.findByRole('menuitem', { name: 'In 1 hour' });
    const [main, sub] = screen.getAllByRole('menu');
    expect(sub).toBeTruthy();
    expect(main?.contains(preset)).toBe(false);
    expect(sub?.contains(preset)).toBe(true);

    fireEvent.click(preset);

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(MESSAGE.id, {
        remindAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      }),
    );
    await waitFor(() => expect(useStore.getState().savedMessageIds.has(MESSAGE.id)).toBe(true));
  });

  it('offers Edit and Delete on your own message, and neither on somebody else’s', async () => {
    await open();
    expect(screen.getByRole('menuitem', { name: 'Edit message' })).toBeTruthy();
    expect(
      screen.getByRole('menuitem', { name: 'Delete message' }).getAttribute('data-variant'),
    ).toBe('destructive');
    cleanup();

    await open(MESSAGE, false);
    expect(screen.queryByRole('menuitem', { name: 'Edit message' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Delete message' })).toBeNull();
    cleanup();

    // A poll's question cannot change under its answers (ADR 0041); it can still go.
    await open({ ...MESSAGE, poll: { question: 'Lunch?' } } as unknown as Message);
    expect(screen.queryByRole('menuitem', { name: 'Edit message' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Delete message' })).toBeTruthy();
  });
});

describe('a dialog opened from the menu', () => {
  it('gives focus back to the message when a dialog from the menu closes', async () => {
    vi.spyOn(api.admin, 'messageVersions').mockResolvedValue({ versions: [], held: false });
    signIn('admin');
    const { row } = await open({ ...MESSAGE, editedAt: '2026-09-01T09:00:00.000Z' } as Message);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Earlier versions' }));
    const dialog = await screen.findByRole('dialog', { name: 'Earlier versions' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(row);
  });

  it('gives focus back to the message from the row’s own dialogs too', async () => {
    // Forward…, Start work and Delete are drawn by the row, at the article's level.
    useStore.setState({
      users: { [ME]: { id: ME, displayName: 'Olga' } },
      customEmoji: [],
      myGroupIds: new Set(),
      editingMessageId: null,
      messageDeliveryState: () => null,
    } as never);
    render(<MessageRow message={MESSAGE} previous={null} onOpenThread={vi.fn()} />);
    const row = document.querySelector<HTMLElement>(`article[data-message-id="${MESSAGE.id}"]`)!;
    fireEvent.click(moreActions());

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete message' }));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(document.activeElement).toBe(row);
  });
});

describe('recording a decision from a message (M2 · A8)', () => {
  it('starts from the message’s words and rests the decision on it', async () => {
    const record = vi.spyOn(api.decisions, 'record').mockResolvedValue({} as never);
    await open();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Record as a decision' }));
    const field = await screen.findByLabelText('What was decided');
    expect((field as HTMLInputElement).value).toBe('hello');
    fireEvent.change(screen.getByLabelText('Why (optional)'), { target: { value: 'Because.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith('c1', {
        title: 'hello',
        rationale: 'Because.',
        messageId: MESSAGE.id,
        clientId: expect.any(String),
      }),
    );
  });

  it('opens the log instead for a message that already is a decision', async () => {
    const router = await import('../../lib/router.ts');
    const go = vi.spyOn(router, 'navigate').mockImplementation(() => {});
    await open({ ...MESSAGE, decisionId: 'd1' } as Message);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open the decision' }));
    expect(go).toHaveBeenCalledWith('/decisions');
  });
});
