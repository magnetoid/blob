// @vitest-environment happy-dom
/**
 * An Escape pressed for a dialog that is open but not yet drawn.
 *
 * In the first second after load a dialog can be opened before the overlay chunk has
 * arrived (`Dialog.chunk.test.tsx`). Its place on the Escape stack is taken in the first
 * load, as it opens, so an Escape pressed then is still the dialog's: the shell's listener
 * on `window` — which closes the thread or marks the channel read — does not hear it, and
 * the dialog closes, once, as soon as the chunk lands and its contents can say how. Its own
 * file, because `lazyOverlay` keeps a chunk that has landed for good, and the case before
 * this one in `Dialog.chunk.test.tsx` lands it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { Dialog, DialogPresence } from './Dialog.tsx';
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

/** Escape as the browser sends it: to whatever has focus. */
function pressEscape() {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
}

describe('an Escape pressed before the dialog is drawn', () => {
  it('is the dialog’s: the shell does not hear it, and the dialog closes once it lands', async () => {
    const chunk = deferred<OverlayModule>();
    vi.mocked(loadOverlays).mockReturnValue(chunk.promise);
    vi.mocked(loadedOverlays).mockReturnValue(null);
    const shell = vi.fn();
    const onClose = vi.fn();

    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            feedback
          </button>
          <DialogPresence when={open}>
            {() => (
              <Dialog
                label="Send feedback"
                onClose={() => {
                  onClose();
                  setOpen(false);
                }}
              >
                <form className="dialog">
                  <input aria-label="Summary" />
                </form>
              </Dialog>
            )}
          </DialogPresence>
        </>
      );
    }

    window.addEventListener('keydown', shell);
    try {
      render(<Opener />);
      fireEvent.click(screen.getByText('feedback'));
      expect(screen.queryByRole('dialog')).toBeNull();

      pressEscape();
      // Nothing is drawn yet that could close, but the key was the dialog's.
      expect(shell).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();

      await act(async () => chunk.resolve(overlayChunk));
      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(shell).not.toHaveBeenCalled();

      // One Escape, one layer: the dialog is gone, so the next one is the shell's.
      pressEscape();
      expect(shell).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', shell);
    }
  });
});
