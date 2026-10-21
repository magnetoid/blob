// @vitest-environment happy-dom
/** Sections of your own in the channel list (M3 · B3). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SidebarSection } from '@blob/shared';
import { Sidebar } from './Sidebar.tsx';
import { MoveToSectionDialog } from './SectionDialogs.tsx';
import { useStore } from '../../lib/store.ts';

vi.mock('../../lib/router.ts', async () => ({
  navigate: vi.fn(),
  parseRoute: () => ({ view: 'messages' }),
  usePath: () => '/',
}));

const ME = { id: 'u1', kind: 'human', displayName: 'Marko', deactivated: false };
const setSidebarSections = vi.fn<(sections: SidebarSection[]) => Promise<void>>(async () => undefined);

function channel(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'public',
    name,
    membership: { isStarred: false },
    archivedAt: null,
    memberIds: ['u1'],
    hasUnread: false,
    mentionCount: 0,
    ...extra,
  };
}

function seed(sections: SidebarSection[]) {
  useStore.setState({
    currentUser: { ...ME, role: 'member', prefs: { sidebarSections: sections } },
    users: { u1: ME },
    channels: {
      c1: channel('c1', 'general'),
      c2: channel('c2', 'acme'),
      c3: channel('c3', 'globex', { hasUnread: true }),
    },
    activeChannelId: null,
    presence: {},
    savedMessageIds: new Set(),
    setSidebarSections,
  } as never);
}

const CLIENTS: SidebarSection = { id: 's1', name: 'Clients', channelIds: ['c2', 'c3'], collapsed: false };

beforeEach(() => setSidebarSections.mockClear());
afterEach(cleanup);

describe('a section of your own', () => {
  it('holds its conversations, and they leave Channels', () => {
    seed([CLIENTS]);
    render(<Sidebar />);
    const clients = screen.getByRole('region', { name: 'Clients' });
    expect(within(clients).getByText('acme')).toBeTruthy();
    expect(within(clients).getByText('globex')).toBeTruthy();
    expect(screen.getAllByText('acme')).toHaveLength(1);
    expect(screen.getByText('general')).toBeTruthy();
  });

  it('folds from its heading, still showing what is unread', () => {
    seed([{ ...CLIENTS, collapsed: true }]);
    render(<Sidebar />);
    const clients = screen.getByRole('region', { name: 'Clients' });
    expect(within(clients).queryByText('acme')).toBeNull();
    expect(within(clients).getByText('globex')).toBeTruthy();
    fireEvent.click(within(clients).getByRole('button', { name: 'Clients' }));
    expect(setSidebarSections).toHaveBeenCalledWith([{ ...CLIENTS, collapsed: false }]);
  });

  it('says how to fill it while it is empty', () => {
    seed([{ ...CLIENTS, channelIds: [] }]);
    render(<Sidebar />);
    expect(screen.getByText('Move a conversation here from its ··· menu.')).toBeTruthy();
  });
});

describe('moving a conversation', () => {
  it('into a new section', () => {
    seed([CLIENTS]);
    render(<MoveToSectionDialog conversationId="c1" name="#general" onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('New section'));
    fireEvent.change(screen.getByLabelText('Name of the new section'), {
      target: { value: 'Launch' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    const saved = setSidebarSections.mock.calls[0]?.[0] ?? [];
    expect(saved.map((s) => s.name)).toEqual(['Clients', 'Launch']);
    expect(saved[1]?.channelIds).toEqual(['c1']);
  });

  it('back out of its section', () => {
    seed([CLIENTS]);
    render(<MoveToSectionDialog conversationId="c2" name="#acme" onClose={vi.fn()} />);
    expect(screen.getByLabelText<HTMLInputElement>('Clients').checked).toBe(true);
    fireEvent.click(screen.getByLabelText('No section'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(setSidebarSections).toHaveBeenCalledWith([{ ...CLIENTS, channelIds: ['c3'] }]);
  });

  it('asks for a name before making a section', () => {
    seed([]);
    render(<MoveToSectionDialog conversationId="c1" name="#general" onClose={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('New section'));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    expect(screen.getByText('Give the section a name.')).toBeTruthy();
    expect(setSidebarSections).not.toHaveBeenCalled();
  });
});
