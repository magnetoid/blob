// @vitest-environment happy-dom
/** The notes agents kept (M2 · A8): read, reworded in place, or forgotten. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteList } from './NoteList.tsx';
import type { AgentNote } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';

afterEach(cleanup);

beforeEach(() => {
  useStore.setState({ channels: {} } as never);
});

const NOTE: AgentNote = {
  id: 'n1',
  pluginId: 'p1',
  agentName: 'Janus',
  channelId: 'c1',
  channelName: 'general',
  channelKind: 'public',
  body: 'Staging is called blue-2.',
  updatedAt: new Date().toISOString(),
};

describe('the notes an agent kept', () => {
  it('shows what it noted, where, and whose agent', () => {
    render(<NoteList notes={[NOTE]} showAgent onReword={vi.fn()} onForget={vi.fn()} />);
    expect(screen.getByText('Staging is called blue-2.')).toBeTruthy();
    expect(screen.getByText(/Janus · #general · written/)).toBeTruthy();
  });

  it('rewords one in place', async () => {
    const reword = vi.fn(async () => {});
    render(<NoteList notes={[NOTE]} showAgent={false} onReword={reword} onForget={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Staging is blue-3.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(reword).toHaveBeenCalledWith(NOTE, 'Staging is blue-3.'));
    await waitFor(() => expect(screen.queryByLabelText('Note')).toBeNull());
  });

  it('forgets one', () => {
    const forget = vi.fn();
    render(<NoteList notes={[NOTE]} showAgent={false} onReword={vi.fn()} onForget={forget} />);
    fireEvent.click(screen.getByRole('button', { name: 'Forget' }));
    expect(forget).toHaveBeenCalledWith(NOTE);
  });
});
