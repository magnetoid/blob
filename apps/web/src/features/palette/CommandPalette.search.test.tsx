// @vitest-environment happy-dom
/**
 * ⌘K finds what was said, not just where to go.
 *
 * The palette listed channels, people and a few verbs, and offered "Search messages…"
 * as an action that navigated away — so the one key people reach for could tell you a
 * channel existed and never what was in it, and the bar's search button left the
 * conversation to answer a question about it. One surface finds anything now; the
 * `/search` page keeps the things a popup should not try to be: modifiers, sorting,
 * paging, and a URL you can send to somebody.
 *
 * The race in the third test is the one worth the file. A search box that renders
 * whichever response lands last shows results for a prefix of what is in it, and looks
 * like a slow server rather than a bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const search = vi.fn();
const showMessage = vi.fn(async () => true);

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  return { ...actual, api: { ...actual.api, search } };
});

vi.mock('../../lib/navigation.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/navigation.ts')>();
  return { ...actual, showMessage };
});

const { CommandPalette } = await import('./CommandPalette.tsx');
const { useStore } = await import('../../lib/store.ts');

afterEach(cleanup);
beforeEach(() => {
  search.mockReset();
  showMessage.mockReset();
});

const message = (id: string, body: string) => ({
  id,
  channelId: 'c1',
  authorId: 'u2',
  body,
  kind: 'user',
  createdAt: '2026-09-01T10:00:00.000Z',
  threadRootId: null,
  replyCount: 0,
  reactions: [],
  attachments: [],
  mentionUserIds: [],
  mentionGroupIds: [],
});

function open(only?: 'people') {
  useStore.setState({
    channels: { c1: { id: 'c1', kind: 'public', name: 'design', archivedAt: null } },
    users: { u2: { id: 'u2', displayName: 'Ana', deactivated: false } },
    currentUser: { id: 'u1', displayName: 'Me', prefs: {} },
  } as never);
  render(<CommandPalette onClose={vi.fn()} only={only} />);
  return screen.getByRole('combobox') as HTMLInputElement;
}

describe('searching messages from the palette', () => {
  it('shows what was said, with who said it and where', async () => {
    search.mockResolvedValue({ messages: [message('m1', 'the deploy gate is green')], total: 1 });
    const input = open();

    fireEvent.change(input, { target: { value: 'deploy' } });

    await waitFor(() => expect(screen.getByText('the deploy gate is green')).toBeTruthy());
    expect(screen.getByText('Ana · #design')).toBeTruthy();
    expect(search).toHaveBeenCalledWith('deploy');
  });

  it('does not ask the server for one character', async () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'd' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(search).not.toHaveBeenCalled();
  });

  it('ignores a slow answer to an older query', async () => {
    // The classic out-of-order race: "de" takes a second, "deploy" comes back at once,
    // and without the guard the list ends up showing results for two letters ago.
    let releaseFirst: (value: unknown) => void = () => {};
    search
      .mockImplementationOnce(
        () => new Promise((resolve) => {
          releaseFirst = resolve;
        }),
      )
      .mockResolvedValueOnce({ messages: [message('m2', 'fresh result')], total: 1 });

    const input = open();
    fireEvent.change(input, { target: { value: 'de' } });
    await new Promise((r) => setTimeout(r, 220));
    fireEvent.change(input, { target: { value: 'deploy' } });
    await waitFor(() => expect(screen.getByText('fresh result')).toBeTruthy());

    releaseFirst({ messages: [message('m3', 'stale result')], total: 1 });
    await new Promise((r) => setTimeout(r, 30));

    expect(screen.queryByText('stale result')).toBeNull();
    expect(screen.getByText('fresh result')).toBeTruthy();
  });

  it('offers the page when there is more than it can show', async () => {
    search.mockResolvedValue({ messages: [message('m1', 'one of many')], total: 40 });
    const input = open();

    fireEvent.change(input, { target: { value: 'deploy' } });

    await waitFor(() => expect(screen.getByText(/See all 40 results/)).toBeTruthy());
  });

  it('opens the message that was chosen', async () => {
    search.mockResolvedValue({ messages: [message('m1', 'the deploy gate is green')], total: 1 });
    const input = open();

    fireEvent.change(input, { target: { value: 'deploy' } });
    await waitFor(() => expect(screen.getByText('the deploy gate is green')).toBeTruthy());
    fireEvent.click(screen.getByText('the deploy gate is green'));

    await waitFor(() => expect(showMessage).toHaveBeenCalledWith('m1'));
  });

  it('stays a people picker when it was opened as one', async () => {
    const input = open('people');
    fireEvent.change(input, { target: { value: 'deploy' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(search).not.toHaveBeenCalled();
  });
});
