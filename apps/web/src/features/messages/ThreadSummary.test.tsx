// @vitest-environment happy-dom
/** A summary's decision becomes one the log keeps, at a person's word (M2 · A8). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ThreadSummary } from '@blob/shared';
import { ThreadSummaryCard } from './ThreadSummary.tsx';
import { api } from '../../lib/api.ts';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SUMMARY = {
  id: 's1',
  channelId: 'c1',
  threadRootId: 'root',
  provider: 'heuristic-v1',
  overview: 'They settled the date.',
  decisions: [
    { text: 'We will ship on Friday.', messageId: 'm2' },
    { text: 'Agreed: weekly demos.', messageId: null },
  ],
  actionItems: [],
  openQuestions: [],
  messageCount: 4,
  updatedAt: '2026-10-20T09:00:00.000Z',
} as unknown as ThreadSummary;

describe('recording a decision from a summary', () => {
  it('rests it on the cited message, or on the thread when none is cited', async () => {
    const record = vi.spyOn(api.decisions, 'record').mockResolvedValue({} as never);
    render(
      <ThreadSummaryCard
        rootId="root"
        summary={SUMMARY}
        loading={false}
        error={null}
        renderOptions={{ knownNames: new Set(), currentUserId: null } as never}
        users={{}}
        onRefreshed={vi.fn()}
      />,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Record' });
    fireEvent.click(first!);
    expect(((await screen.findByLabelText('What was decided')) as HTMLInputElement).value).toBe(
      'We will ship on Friday.',
    );
    const submitIn = () =>
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record' }));
    submitIn();
    await waitFor(() =>
      expect(record).toHaveBeenCalledWith('c1', {
        title: 'We will ship on Friday.',
        rationale: undefined,
        messageId: 'm2',
        clientId: expect.any(String),
      }),
    );
    expect(await screen.findByText('Recorded')).toBeTruthy();

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(second!);
    await screen.findByLabelText('What was decided');
    submitIn();
    await waitFor(() =>
      expect(record).toHaveBeenLastCalledWith('c1', expect.objectContaining({ messageId: 'root' })),
    );
  });
});
