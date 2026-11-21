// @vitest-environment happy-dom
/** The Tasks page, where it has nothing to show yet. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../lib/api.ts', () => ({
  api: { agentic: { listTasks: vi.fn(async () => ({ tasks: [] })) } },
}));

const { TasksView } = await import('./TasksView.tsx');
const { useStore } = await import('../../lib/store.ts');

afterEach(cleanup);

describe('the Tasks page', () => {
  it('draws Tasks with the task icon', async () => {
    // The same list the sidebar's Tasks row and Home's "Open tasks" wear, and not the
    // sheet of paper, which is the Files row's.
    useStore.setState({
      currentUser: { id: 'u1', kind: 'human', displayName: 'Marko', role: 'member', deactivated: false },
      channels: {},
    } as never);
    render(<TasksView />);

    const empty = (await screen.findByText('No tasks yet')).closest('[data-slot="empty"]')!;
    expect(empty.querySelector('[data-slot="empty-icon"] svg.lucide-list-todo')).not.toBeNull();
    expect(empty.querySelector('svg.lucide-file')).toBeNull();
  });
});
