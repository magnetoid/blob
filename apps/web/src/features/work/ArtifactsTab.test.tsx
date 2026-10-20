// @vitest-environment happy-dom
/**
 * The Changes and Preview tabs (M2 · A10). Pinned: versions fold into one artifact with a
 * picker; a verdict goes to the version on screen; sending back needs a reason and says
 * who will hear it; Discuss opens the artifact's thread; publishing under an existing
 * title says which version it will be; and a finished work offers none of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Work, WorkArtifact } from '@blob/shared';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { ArtifactsTab } from './ArtifactsTab.tsx';
import { groupArtifacts } from './artifacts.ts';

const showThread = vi.fn();
vi.mock('../../lib/navigation.ts', () => ({
  showThread: (...args: unknown[]) => showThread(...args),
}));

const WORK: Work = {
  id: 'w1',
  channelId: 'c1',
  rootMessageId: null,
  rootChannelId: null,
  title: 'Rate limiting',
  status: 'open',
  createdBy: 'u1',
  createdAt: '2026-10-20T09:00:00.000Z',
  doneBy: null,
  doneAt: null,
  artifactCount: 2,
} as Work;

function artifact(overrides: Partial<WorkArtifact>): WorkArtifact {
  return {
    id: 'a1',
    workId: 'w1',
    runId: null,
    kind: 'diff',
    title: 'Fix login',
    body: '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n',
    authorUserId: 'bot1',
    createdAt: '2026-10-20T09:00:00.000Z',
    version: 1,
    supersedesId: null,
    reviewRootId: null,
    reviews: [],
    ...overrides,
  };
}

const V1 = artifact({ id: 'a1' });
const V2 = artifact({
  id: 'a2',
  version: 2,
  supersedesId: 'a1',
  body: '--- a/x\n+++ b/x\n@@ -1 +1,2 @@\n a\n+second\n',
  createdAt: '2026-10-20T10:00:00.000Z',
});
const OTHER = artifact({ id: 'a3', title: 'Cache headers', createdAt: '2026-10-20T08:00:00.000Z' });

beforeEach(() => {
  const names: Record<string, string> = { u1: 'Ana', u2: 'Bo', bot1: 'Janus' };
  useStore.setState({
    currentUser: { id: 'u1', displayName: 'Ana', role: 'member' } as never,
    users: {
      bot1: { id: 'bot1', kind: 'bot', displayName: 'Janus' },
      u2: { id: 'u2', kind: 'human', displayName: 'Bo' },
    } as never,
    displayNameOf: (id: string) => names[id] ?? 'someone',
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  showThread.mockReset();
});

describe('versions', () => {
  it('folds versions into one artifact, newest on top, with a picker', () => {
    render(<ArtifactsTab which="changes" work={WORK} artifacts={[V1, V2, OTHER]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('v2')).toBeTruthy();
    expect(screen.getByText(/published v2/)).toBeTruthy();

    const picker = screen.getByRole('combobox', { name: 'Version' }) as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual(['v2 · latest', 'v1']);
    fireEvent.change(picker, { target: { value: 'a1' } });
    expect(screen.getByText(/published v1/)).toBeTruthy();
  });

  it('matches titles as the server does', () => {
    const groups = groupArtifacts([V1, artifact({ id: 'a9', title: '  FIX login ', version: 2 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.latest.id).toBe('a9');
  });
});

describe('review', () => {
  it('approves the version on screen', async () => {
    const review = vi.spyOn(api.work, 'review').mockResolvedValue({ artifact: V2 });
    render(<ArtifactsTab which="changes" work={WORK} artifacts={[V1, V2]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(review).toHaveBeenCalledWith('w1', 'a2', 'approved', undefined));
  });

  it('sends back only with a reason, and says the agent will be asked', async () => {
    const review = vi.spyOn(api.work, 'review').mockResolvedValue({ artifact: V2 });
    render(<ArtifactsTab which="changes" work={WORK} artifacts={[V1, V2]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(screen.getByText('Janus is asked in the thread to make the change.')).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send back' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'What should change' }), {
      target: { value: 'Use 60 a minute.' },
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(review).toHaveBeenCalledWith('w1', 'a2', 'changes', 'Use 60 a minute.'),
    );
  });

  it('shows each verdict with whose it is', () => {
    render(
      <ArtifactsTab
        which="changes"
        work={WORK}
        artifacts={[
          artifact({
            reviews: [
              { userId: 'u2', verdict: 'changes', note: 'More tests', at: '2026-10-20T11:00:00Z' },
              { userId: 'u1', verdict: 'approved', note: null, at: '2026-10-20T10:00:00Z' },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText('Changes requested by Bo').getAttribute('title')).toBe('More tests');
    expect(screen.getByText('Approved by Ana')).toBeTruthy();
    // Already approved by the reader: the button says so rather than offering it again.
    expect((screen.getByRole('button', { name: 'Approved' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens the artifact’s thread', async () => {
    vi.spyOn(api.work, 'discuss').mockResolvedValue({ threadRootId: 'm9' });
    render(<ArtifactsTab which="changes" work={WORK} artifacts={[V1]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Discuss' }));
    await waitFor(() => expect(showThread).toHaveBeenCalledWith('c1', 'm9'));
  });

  it('offers nothing to a finished work but its thread', () => {
    const done = { ...WORK, status: 'done' } as Work;
    render(
      <ArtifactsTab which="changes" work={done} artifacts={[artifact({ reviewRootId: 'm9' })]} />,
    );
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open the thread' })).toBeTruthy();
  });
});

describe('publishing by hand', () => {
  it('says which version a known title will be, and publishes it', async () => {
    const publish = vi.spyOn(api.work, 'publish').mockResolvedValue({ artifact: V2 });
    render(<ArtifactsTab which="changes" work={WORK} artifacts={[V1, V2]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = within(screen.getByRole('dialog'));
    fireEvent.change(dialog.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'fix LOGIN' },
    });
    expect(dialog.getByText('This will be v3 of Fix login.')).toBeTruthy();
    fireEvent.change(dialog.getByRole('textbox', { name: 'Diff' }), {
      target: { value: '--- a\n+++ b\n@@\n+c\n' },
    });
    fireEvent.click(dialog.getByRole('button', { name: 'Publish v3' }));
    await waitFor(() =>
      expect(publish).toHaveBeenCalledWith('w1', {
        kind: 'diff',
        title: 'fix LOGIN',
        body: '--- a\n+++ b\n@@\n+c\n',
      }),
    );
  });

  it('offers to publish from an empty tab', () => {
    render(<ArtifactsTab which="preview" work={WORK} artifacts={[]} />);
    expect(screen.getByText(/you can publish one yourself/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(
      (within(screen.getByRole('dialog')).getByRole('radio', { name: /Document/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });
});

describe('a page or a document', () => {
  it('draws its review and its preview without a key either shares', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ArtifactsTab
        which="preview"
        work={WORK}
        artifacts={[artifact({ kind: 'markdown', title: 'Launch notes', body: '# Notes' })]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(errors.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false);
  });
});
