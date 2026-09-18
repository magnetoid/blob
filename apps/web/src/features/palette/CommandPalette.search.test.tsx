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
const listFiles = vi.fn();
const showMessage = vi.fn(async () => true);
const navigate = vi.fn();

/** The dotted name of every api call the palette made that was not one of the two above. */
const strayCalls: string[] = [];

/**
 * Replace every other api function with a recorder.
 *
 * The palette is allowed exactly two requests, and the interesting failure is a third —
 * a channel list, a member list, anything that would send the asker's reach back to the
 * server. Passing the real functions through would make that a silent fetch; this makes
 * it a name in `strayCalls`.
 */
function recorded(from: Record<string, unknown>, path: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(from)) {
    const here = path ? `${path}.${key}` : key;
    if (typeof value === 'function') {
      out[key] = () => {
        strayCalls.push(here);
        return Promise.resolve({});
      };
    } else if (value && typeof value === 'object') {
      out[key] = recorded(value as Record<string, unknown>, here);
    } else {
      out[key] = value;
    }
  }
  return out;
}

vi.mock('../../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api.ts')>();
  const rest = recorded(actual.api as unknown as Record<string, unknown>, '');
  return {
    ...actual,
    api: {
      ...rest,
      search,
      files: { ...(rest.files as Record<string, unknown>), list: listFiles },
    },
  };
});

vi.mock('../../lib/navigation.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/navigation.ts')>();
  return { ...actual, showMessage };
});

vi.mock('../../lib/router.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/router.ts')>();
  return { ...actual, navigate };
});

const { CommandPalette } = await import('./CommandPalette.tsx');
const { useStore } = await import('../../lib/store.ts');

afterEach(cleanup);
beforeEach(() => {
  search.mockReset();
  listFiles.mockReset();
  showMessage.mockReset();
  navigate.mockReset();
  strayCalls.length = 0;
  search.mockResolvedValue({ messages: [], total: 0 });
  listFiles.mockResolvedValue({ items: [], nextCursor: null });
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

const channel = (id: string, name: string) => ({
  id,
  kind: 'public',
  name,
  archivedAt: null,
  membership: null,
});

function open(only?: 'people', extraChannels: Record<string, unknown> = {}) {
  useStore.setState({
    channels: {
      c1: channel('c1', 'design'),
      c2: channel('c2', 'deploys'),
      ...extraChannels,
    },
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

const file = (id: string, filename: string, messageId: string) => ({
  id,
  filename,
  mime: 'application/pdf',
  sizeBytes: 100,
  width: null,
  height: null,
  url: `/api/files/${id}`,
  thumbUrl: null,
  kind: 'file',
  durationMs: null,
  waveform: null,
  transcriptStatus: 'none',
  transcriptProvider: null,
  channelId: 'c1',
  messageId,
  createdAt: '2026-09-01T10:00:00.000Z',
});

describe('search scopes', () => {
  it('draws a section for each kind of thing', async () => {
    search.mockResolvedValue({ messages: [message('m1', 'the deploy gate')], total: 1 });
    listFiles.mockResolvedValue({ items: [file('f1', 'deploy-runbook.pdf', 'm1')], nextCursor: null });

    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });

    await waitFor(() => expect(screen.getByText('deploy-runbook.pdf')).toBeTruthy());
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('Messages')).toBeTruthy();
    expect(screen.getByText('Files')).toBeTruthy();
    expect(listFiles).toHaveBeenCalledWith(expect.objectContaining({ q: 'deploy' }));
  });

  it('Tab narrows the search, and says so', async () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });

    expect(input.getAttribute('aria-label')).toContain('everything');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.getAttribute('aria-label')).toContain('channels');
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.getAttribute('aria-label')).toContain('people');
    // And back, so the cycle is walkable in both directions.
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(input.getAttribute('aria-label')).toContain('channels');

    // The same step by pointer, which is a phone's only way to it: the indicator is a
    // button, and its name says so rather than leaving a glyph to be read aloud.
    fireEvent.click(screen.getByRole('button', { name: /change what is searched/ }));
    expect(input.getAttribute('aria-label')).toContain('people');
  });

  it('Tab reaches Files, and a filename opens the message it is attached to', async () => {
    listFiles.mockResolvedValue({ items: [file('f1', 'deploy-runbook.pdf', 'm7')], nextCursor: null });

    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });
    for (let i = 0; i < 4; i += 1) fireEvent.keyDown(input, { key: 'Tab' });
    expect(input.getAttribute('aria-label')).toContain('files');

    await waitFor(() => expect(screen.getByText('deploy-runbook.pdf')).toBeTruthy());
    // Narrowed to one section, only that section's request goes out.
    expect(search).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('deploy-runbook.pdf'));
    await waitFor(() => expect(showMessage).toHaveBeenCalledWith('m7'));
  });

  it('does not ask for files for one character', async () => {
    const input = open();
    fireEvent.change(input, { target: { value: 'd' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('never lists a private channel the asker is not in', async () => {
    // The store holds exactly the asker's reach (memberships plus public channels), and
    // the palette reads nothing else for channels — so there is no second path to leak.
    // That is only true while the palette asks for nothing but messages and files, which
    // is what `strayCalls` pins: a channel or member listing added later would show up
    // here as a name rather than as a quiet request nobody noticed.
    const input = open();
    fireEvent.change(input, { target: { value: 'secret' } });
    await new Promise((r) => setTimeout(r, 250));

    expect(search).toHaveBeenCalledTimes(1);
    expect(listFiles).toHaveBeenCalledTimes(1);
    expect(strayCalls).toEqual([]);
    expect(screen.queryByText('#secret-plans')).toBeNull();
  });

  it('asks the server for nothing when it is a people picker', async () => {
    const input = open('people');
    fireEvent.change(input, { target: { value: 'deploy' } });
    await new Promise((r) => setTimeout(r, 250));
    expect(search).not.toHaveBeenCalled();
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('heads a section only when it has rows, and gives each five of them', async () => {
    // A header over nothing would claim the asker's term matched a kind of thing it did
    // not. Nothing here matches a channel, so there must be no Channels header.
    listFiles.mockResolvedValue({ items: [file('f1', 'deploy-runbook.pdf', 'm1')], nextCursor: null });
    let input = open();
    fireEvent.change(input, { target: { value: 'runbook' } });

    await waitFor(() => expect(screen.getByText('Files')).toBeTruthy());
    expect(screen.queryByText('Channels')).toBeNull();
    expect(screen.queryByText('People')).toBeNull();
    expect(screen.queryByText('Messages')).toBeNull();

    // And when a section has more than its share of the list, it shows five and offers
    // the page — the four sections stay a glance rather than becoming a scroll.
    cleanup();
    listFiles.mockResolvedValue({ items: [], nextCursor: null });
    input = open(undefined, {
      c3: channel('c3', 'deploy-notes'),
      c4: channel('c4', 'deploy-logs'),
      c5: channel('c5', 'deploy-old'),
      c6: channel('c6', 'deploy-new'),
      c7: channel('c7', 'deploy-next'),
    });
    fireEvent.change(input, { target: { value: 'deploy' } });

    await waitFor(() => expect(screen.getByText('Channels')).toBeTruthy());
    expect(screen.getAllByText(/^#deploy/).length).toBe(5);
    expect(screen.getByText('See all 6 channels')).toBeTruthy();
  });

  it('asks for a term instead of saying nothing matched, in a narrowed scope', async () => {
    // ⌘K then Tab twice lands on an empty Messages scope. "Nothing matched" would blame
    // the asker for a search they have not made yet.
    const input = open();
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(input, { key: 'Tab' });

    expect(screen.getByText('Type to search messages')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Tab' });
    expect(screen.getByText('Type to search files')).toBeTruthy();
    // Channels and people are already in the store, so their list is an answer, not a
    // prompt: Tab back round to channels and the jump list is there.
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(screen.getByText('#design')).toBeTruthy();
  });

  it('sends See all files to the search page with the files scope', async () => {
    listFiles.mockResolvedValue({
      items: [
        file('f1', 'deploy-1.pdf', 'm1'),
        file('f2', 'deploy-2.pdf', 'm2'),
        file('f3', 'deploy-3.pdf', 'm3'),
        file('f4', 'deploy-4.pdf', 'm4'),
        file('f5', 'deploy-5.pdf', 'm5'),
        file('f6', 'deploy-6.pdf', 'm6'),
      ],
      nextCursor: null,
    });

    const input = open();
    fireEvent.change(input, { target: { value: 'deploy' } });
    await waitFor(() => expect(screen.getByText(/See all files/)).toBeTruthy());
    fireEvent.click(screen.getByText(/See all files/));

    expect(navigate).toHaveBeenCalledWith('/search?q=deploy&scope=files');
  });
});
