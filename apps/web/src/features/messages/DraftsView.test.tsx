// @vitest-environment happy-dom
/** Drafts: what you typed and did not send, newest first, from every device (ADR 0037). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DraftsView } from './DraftsView.tsx';
import { useStore } from '../../lib/store.ts';

const setDraft = vi.fn();

beforeEach(() => {
  useStore.setState({
    drafts: {
      c1: { body: 'older thought', updatedAt: '2026-10-21T08:00:00.000Z' },
      'c1:m9': { body: 'a reply in progress', updatedAt: '2026-10-21T09:00:00.000Z' },
      c2: { body: '', updatedAt: '2026-10-21T10:00:00.000Z', unsynced: true },
      gone: { body: 'in a room I left', updatedAt: '2026-10-21T11:00:00.000Z' },
    },
    channels: {
      c1: { id: 'c1', kind: 'public', name: 'general' },
      c2: { id: 'c2', kind: 'public', name: 'random' },
    },
    channelTitle: (channel: { name: string }) => `#${channel.name}`,
    setDraft,
  } as never);
});
afterEach(() => {
  cleanup();
  setDraft.mockClear();
});

describe('the drafts list', () => {
  it('shows what is unsent, newest first, and says which are replies', () => {
    render(<DraftsView />);
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('A reply in #general');
    expect(rows[0]).toContain('a reply in progress');
    expect(rows[1]).toContain('older thought');
  });

  it('deletes one', () => {
    render(<DraftsView />);
    const [replyDelete] = screen.getAllByRole('button', { name: 'Delete the draft in #general' });
    fireEvent.click(replyDelete as HTMLElement);
    expect(setDraft).toHaveBeenCalledWith('c1', 'm9', '');
  });

  it('is empty when nothing is unsent', () => {
    useStore.setState({ drafts: {} } as never);
    render(<DraftsView />);
    expect(screen.getByText('No drafts')).toBeTruthy();
  });
});
