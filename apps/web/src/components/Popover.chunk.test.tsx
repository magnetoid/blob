// @vitest-environment happy-dom
/**
 * A popover opened before the overlay chunk has arrived.
 *
 * In the first second after load somebody can click an author's name, or a message's
 * "Add reaction", before the preload has fetched Base UI. The click is not lost: the
 * caller has already said open, nothing is drawn — and once the chunk lands the card or
 * the picker is open, with focus inside it, as if it had been there all along. Unless the
 * person has moved on while it was on its way: then it opens where it is and leaves their
 * focus alone — the picker's search field included, which used to take focus as it mounted.
 * Its own file, because `lib/overlays.ts` is mocked to hold the chunk back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import type { OverlayModule } from '../lib/overlays.ts';
// The chunk itself, evaluated while the file is collected rather than inside the test.
import * as overlayChunk from './overlays/index.ts';

vi.mock('../lib/overlays.ts', () => ({ loadOverlays: vi.fn(), loadedOverlays: vi.fn(() => null) }));
vi.mock('../lib/api.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api.ts')>();
  return {
    ...actual,
    api: { ...actual.api, users: { ...actual.api.users, get: vi.fn(() => new Promise(() => {})) } },
  };
});

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const person = {
  id: 'u1',
  kind: 'human' as const,
  displayName: 'Ana',
  fullName: null,
  title: null,
  avatarUrl: null,
  timezone: 'UTC',
  role: 'member' as const,
  statusEmoji: null,
  statusText: null,
  statusExpiresAt: null,
  deactivated: false,
  agentDisabled: false,
  agentResident: false,
  placeholder: false,
};

/** Fresh modules with the chunk still on its way, and the means to land it. */
async function withTheChunkOnItsWay() {
  vi.resetModules();
  const overlays = await import('../lib/overlays.ts');
  const chunk = deferred<OverlayModule>();
  vi.mocked(overlays.loadOverlays).mockReturnValue(chunk.promise);
  vi.mocked(overlays.loadedOverlays).mockReturnValue(null);
  const { useStore } = await import('../lib/store.ts');
  useStore.setState({
    currentUser: { id: 'me', displayName: 'Me' },
    users: { u1: person },
    customEmoji: [],
  } as never);
  return {
    loadOverlays: overlays.loadOverlays,
    land: () => act(async () => chunk.resolve(overlayChunk)),
  };
}

/** Past the frame Base UI moves initial focus in. */
const settle = () => act(() => new Promise((done) => setTimeout(done, 50)));

describe('a person card opened before its chunk lands', () => {
  async function authorName() {
    const { PersonCard } = await import('./PersonCard.tsx');
    return function AuthorName() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <span className="person-trigger-wrap">
            <button type="button" onClick={() => setOpen(true)}>
              Ana
            </button>
            <PersonCard person={person} open={open} onClose={() => setOpen(false)} />
          </span>
          <button type="button">Reply</button>
        </>
      );
    };
  }

  it('a person card opened before the chunk arrives is open once it lands', async () => {
    const { loadOverlays, land } = await withTheChunkOnItsWay();
    const AuthorName = await authorName();

    render(<AuthorName />);
    const trigger = screen.getByRole('button', { name: 'Ana' });
    trigger.focus();
    fireEvent.click(trigger);

    expect(loadOverlays).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    await land();

    expect(screen.getByRole('dialog', { name: 'Ana' })).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Message Ana' })),
    );
  });

  it('leaves focus where the person moved it while the chunk was on its way', async () => {
    const { land } = await withTheChunkOnItsWay();
    const AuthorName = await authorName();

    render(<AuthorName />);
    const trigger = screen.getByRole('button', { name: 'Ana' });
    trigger.focus();
    fireEvent.click(trigger);
    const reply = screen.getByRole('button', { name: 'Reply' });
    reply.focus();

    await land();
    await settle();

    expect(screen.getByRole('dialog', { name: 'Ana' })).toBeTruthy();
    expect(document.activeElement).toBe(reply);
  });
});

describe('an emoji picker opened before its chunk lands', () => {
  async function addReaction() {
    const { EmojiPicker } = await import('./EmojiPicker.tsx');
    return function AddReaction() {
      const [open, setOpen] = useState(false);
      const anchor = useRef<HTMLDivElement>(null);
      return (
        <>
          <div className="emoji-picker-anchor" ref={anchor}>
            <button type="button" aria-label="Add reaction" onClick={() => setOpen(true)}>
              ＋
            </button>
            {open && (
              <EmojiPicker label="React with an emoji" onClose={() => setOpen(false)} onPick={() => setOpen(false)} />
            )}
          </div>
          <button type="button">Reply</button>
        </>
      );
    };
  }

  it('puts the cursor in its search field once it lands', async () => {
    const { land } = await withTheChunkOnItsWay();
    const AddReaction = await addReaction();

    render(<AddReaction />);
    const trigger = screen.getByRole('button', { name: 'Add reaction' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();

    await land();

    expect(screen.getByRole('dialog', { name: 'React with an emoji' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Search emoji')));
  });

  it('does not take focus back from where the person moved it', async () => {
    const { land } = await withTheChunkOnItsWay();
    const AddReaction = await addReaction();

    render(<AddReaction />);
    const trigger = screen.getByRole('button', { name: 'Add reaction' });
    trigger.focus();
    fireEvent.click(trigger);
    const reply = screen.getByRole('button', { name: 'Reply' });
    reply.focus();

    await land();
    await settle();

    expect(screen.getByRole('dialog', { name: 'React with an emoji' })).toBeTruthy();
    expect(document.activeElement).toBe(reply);
  });
});
