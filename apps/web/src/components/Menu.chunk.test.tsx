// @vitest-environment happy-dom
/**
 * A menu opened before the overlay chunk has arrived.
 *
 * In the first second after load somebody can click a message's ••• before the preload
 * has fetched Base UI. The click is not lost: the caller has already set `open`, the menu
 * holds it, nothing is drawn — and once the chunk lands the menu is open, with focus on
 * its first item, as if it had been there all along. Unless the person has moved on while
 * it was on its way: then the menu opens where it is and leaves their focus alone. Its own
 * file, because `lib/overlays.ts` is mocked to hold the chunk back; `Menu.test.tsx` starts
 * with it here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { OverlayModule } from '../lib/overlays.ts';
// The chunk itself, evaluated while the file is collected rather than inside the test,
// where its second or so of evaluation would count against the test's timeout.
import * as overlayChunk from './overlays/index.ts';

vi.mock('../lib/overlays.ts', () => ({ loadOverlays: vi.fn(), loadedOverlays: vi.fn(() => null) }));

afterEach(cleanup);

/** A promise settled from outside: the chunk, still on the wire. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * A `Menu` whose chunk is still on its way, and the means to land it. `lazyOverlay` keeps
 * the chunk for good once it has it, so each case loads `Menu` afresh.
 */
async function withTheChunkOnItsWay() {
  vi.resetModules();
  const overlays = await import('../lib/overlays.ts');
  const chunk = deferred<OverlayModule>();
  vi.mocked(overlays.loadOverlays).mockReturnValue(chunk.promise);
  vi.mocked(overlays.loadedOverlays).mockReturnValue(null);
  const { Menu } = await import('./Menu.tsx');

  function MoreActions() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <div className="relative">
          <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)}>
            More actions
          </button>
          <Menu open={open} onClose={() => setOpen(false)} className="menu">
            <button role="menuitem" type="button">
              Copy link
            </button>
            <button role="menuitem" type="button">
              Forward…
            </button>
          </Menu>
        </div>
        <button type="button">Reply</button>
      </>
    );
  }

  return {
    MoreActions,
    loadOverlays: overlays.loadOverlays,
    land: () => act(async () => chunk.resolve(overlayChunk)),
  };
}

describe('a menu opened before its chunk lands', () => {
  it('a click before the chunk arrives opens the menu once it lands', async () => {
    const { MoreActions, loadOverlays, land } = await withTheChunkOnItsWay();

    render(<MoreActions />);
    const trigger = screen.getByText('More actions');
    trigger.focus();
    fireEvent.click(trigger);

    // Asked for, and nothing drawn yet — but the caller's intent is held.
    expect(loadOverlays).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await land();

    expect(screen.getByRole('menu')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Copy link')));
  });

  it('leaves focus where the person moved it while the chunk was on its way', async () => {
    const { MoreActions, land } = await withTheChunkOnItsWay();

    render(<MoreActions />);
    const trigger = screen.getByText('More actions');
    trigger.focus();
    fireEvent.click(trigger);
    // Tab, with nothing drawn to Tab into: on to the next control on the page.
    const reply = screen.getByText('Reply');
    reply.focus();

    await land();
    // Past the frame Base UI moves initial focus in.
    await act(() => new Promise((settle) => setTimeout(settle, 50)));

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(reply);
  });
});
