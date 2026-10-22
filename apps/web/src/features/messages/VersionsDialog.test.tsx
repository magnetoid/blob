// @vitest-environment happy-dom
/**
 * Earlier versions (ADR 0039 addendum): an admin reads what a legal hold kept of an edited
 * message, from the ••• menu, and nobody else is offered it. The person editing is told
 * when their earlier words are kept, and so is the person deleting.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Message } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { MessageMenu } from './MessageMenu.tsx';
import { MessageEditor } from './MessageEditor.tsx';
import { VersionsDialog } from './VersionsDialog.tsx';
import { DeleteConfirm } from './MessageRow.tsx';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EDITED = {
  id: '01a05000-0000-7000-8000-0000000000aa',
  channelId: 'c1',
  authorId: 'u2',
  body: 'the budget is 15k',
  kind: 'user',
  createdAt: '2026-10-20T09:00:00.000Z',
  editedAt: '2026-10-21T09:00:00.000Z',
  deletedAt: null,
  threadRootId: null,
  replyCount: 0,
  reactions: [],
  attachments: [],
} as unknown as Message;

function menu(role: 'owner' | 'admin' | 'member', message: Message = EDITED) {
  useStore.setState({
    currentUser: { id: 'u1', displayName: 'Olga', role, prefs: {} },
    savedMessageIds: new Set(),
    activeThreadRootId: null,
  } as never);
  render(
    <MessageMenu
      message={message}
      mine={false}
      onCopyLink={vi.fn()}
      onForward={vi.fn()}
      onEdit={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText('More actions'));
}

describe('earlier versions', () => {
  it('are offered to an admin on an edited message, and to nobody else', () => {
    menu('admin');
    expect(screen.getByRole('menuitem', { name: 'Earlier versions' })).toBeTruthy();
    cleanup();
    menu('member');
    expect(screen.queryByRole('menuitem', { name: 'Earlier versions' })).toBeNull();
    cleanup();
    menu('owner', { ...EDITED, editedAt: null } as Message);
    expect(screen.queryByRole('menuitem', { name: 'Earlier versions' })).toBeNull();
  });

  it('lists what was kept, oldest first, then what it says now', async () => {
    const versions = vi.spyOn(api.admin, 'messageVersions').mockResolvedValue({
      versions: [
        { body: 'the budget is 10k', writtenAt: '2026-10-20T09:00:00.000Z', replacedAt: '2026-10-20T10:00:00.000Z' },
        { body: 'the budget is 12k', writtenAt: '2026-10-20T10:00:00.000Z', replacedAt: '2026-10-21T09:00:00.000Z' },
      ],
      held: true,
    });
    render(<VersionsDialog messageId={EDITED.id} current={EDITED.body} onClose={vi.fn()} />);
    expect(await screen.findByText('the budget is 10k')).toBeTruthy();
    const bodies = Array.from(document.querySelectorAll('.versions-body'), (p) => p.textContent);
    expect(bodies).toEqual(['the budget is 10k', 'the budget is 12k', 'the budget is 15k']);
    expect(screen.getByText('On legal hold: an edit now keeps the words it replaces.')).toBeTruthy();
    expect(versions).toHaveBeenCalledWith(EDITED.id);
  });

  it('says why none were kept', async () => {
    vi.spyOn(api.admin, 'messageVersions').mockResolvedValue({ versions: [], held: false });
    render(<VersionsDialog messageId={EDITED.id} current={EDITED.body} onClose={vi.fn()} />);
    expect(await screen.findByText(/None were kept/)).toBeTruthy();
    expect(screen.getByText('Not on legal hold now: an edit now keeps nothing.')).toBeTruthy();
  });
});

describe('the person editing is told', () => {
  function editor(channelHeld: boolean, selfHeld: boolean) {
    useStore.setState({
      currentUser: { id: 'u2', displayName: 'Max', role: 'member', prefs: { enterToSend: true } },
      channels: { c1: { id: 'c1', kind: 'public', name: 'general', legalHoldAt: channelHeld ? '2026-10-01T00:00:00.000Z' : null } },
      retention: { messageDays: null, fileDays: null, held: selfHeld },
    } as never);
    render(<MessageEditor message={EDITED} onClose={vi.fn()} />);
  }

  it('when the conversation is on hold', () => {
    editor(true, false);
    expect(screen.getByText('This conversation is on legal hold, so the words you replace are kept.')).toBeTruthy();
  });

  it('when they are', () => {
    editor(false, true);
    expect(screen.getByText('You are on legal hold, so the words you replace are kept.')).toBeTruthy();
  });

  it('and nothing at all when nothing is held', () => {
    editor(false, false);
    expect(screen.queryByText(/legal hold/)).toBeNull();
  });
});

describe('the person deleting is told', () => {
  function confirm(held: boolean, message: Message = EDITED) {
    useStore.setState({
      currentUser: { id: 'u2', displayName: 'Max', role: 'member', prefs: {} },
      channels: { c1: { id: 'c1', kind: 'public', name: 'general', legalHoldAt: held ? '2026-10-01T00:00:00.000Z' : null } },
      retention: { messageDays: null, fileDays: null, held: false },
    } as never);
    render(<DeleteConfirm message={message} onClose={vi.fn()} />);
  }

  it('that what the hold kept of its edits stays', () => {
    confirm(true);
    expect(screen.getByText(/The words its edits replaced stay kept while the legal hold lasts/)).toBeTruthy();
  });

  it('nothing more when there is no hold, or nothing was edited', () => {
    confirm(false);
    expect(screen.queryByText(/legal hold/)).toBeNull();
    cleanup();
    confirm(true, { ...EDITED, editedAt: null } as Message);
    expect(screen.queryByText(/legal hold/)).toBeNull();
    expect(screen.getByText('It disappears for everyone. There is no undo.')).toBeTruthy();
  });
});
