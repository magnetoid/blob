// @vitest-environment happy-dom
/**
 * A menu opened before the overlay chunk has arrived.
 *
 * In the first second after load somebody can click a message's ••• before the preload
 * has fetched Base UI. The click is not lost: the caller has already set `open`, the menu
 * holds it, nothing is drawn — and once the chunk lands the menu is open, with focus on
 * its first item, as if it had been there all along. Its own file, because
 * `lib/overlays.ts` is mocked to hold the chunk back; `Menu.test.tsx` starts with it here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Menu } from './Menu.tsx';
import { loadOverlays, loadedOverlays, type OverlayModule } from '../lib/overlays.ts';
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

describe('a menu opened before its chunk lands', () => {
  it('a click before the chunk arrives opens the menu once it lands', async () => {
    const chunk = deferred<OverlayModule>();
    vi.mocked(loadOverlays).mockReturnValue(chunk.promise);
    vi.mocked(loadedOverlays).mockReturnValue(null);

    function MoreActions() {
      const [open, setOpen] = useState(false);
      return (
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
      );
    }

    render(<MoreActions />);
    const trigger = screen.getByText('More actions');
    trigger.focus();
    fireEvent.click(trigger);

    // Asked for, and nothing drawn yet — but the caller's intent is held.
    expect(loadOverlays).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await act(async () => chunk.resolve(overlayChunk));

    expect(screen.getByRole('menu')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Copy link')));
  });
});
