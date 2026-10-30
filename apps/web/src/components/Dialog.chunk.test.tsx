// @vitest-environment happy-dom
/**
 * A dialog opened before the overlay chunk has arrived.
 *
 * In the first second after load somebody can open a dialog before the preload has
 * fetched Base UI. The click is not lost: `DialogPresence` holds the opening, nothing is
 * drawn and nothing runs — not even the component it opens, whose on-mount work
 * (CatchUpPanel's request, a form's focus) waits for its body to exist — and the dialog
 * opens, once, when the chunk lands. Its own file, because `lib/overlays.ts` is mocked to
 * hold the chunk back; `Dialog.test.tsx` starts with it already here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
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

describe('a dialog opened before its chunk lands', () => {
  it('opens once the chunk lands, having run nothing before', async () => {
    const chunk = deferred<OverlayModule>();
    vi.mocked(loadOverlays).mockReturnValue(chunk.promise);
    vi.mocked(loadedOverlays).mockReturnValue(null);
    const mounted = vi.fn();

    function Feedback({ onClose }: { onClose: () => void }) {
      const summary = useRef<HTMLInputElement>(null);
      useEffect(() => {
        mounted();
        summary.current?.focus();
      }, []);
      return (
        <Dialog label="Send feedback" onClose={onClose}>
          <form className="dialog">
            <button type="button">Bug</button>
            <input ref={summary} aria-label="Summary" />
          </form>
        </Dialog>
      );
    }
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            feedback
          </button>
          <DialogPresence when={open}>{() => <Feedback onClose={() => setOpen(false)} />}</DialogPresence>
        </>
      );
    }

    render(<Opener />);
    fireEvent.click(screen.getByText('feedback'));

    // Asked for, not yet drawn, and nothing of it has run.
    expect(loadOverlays).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mounted).not.toHaveBeenCalled();

    await act(async () => chunk.resolve(overlayChunk));

    expect(screen.getByRole('dialog', { name: 'Send feedback' })).toBeTruthy();
    expect(mounted).toHaveBeenCalledTimes(1);
    // Its body was there when it ran, so the field it wanted has focus.
    expect(document.activeElement).toBe(screen.getByLabelText('Summary'));
  });
});
