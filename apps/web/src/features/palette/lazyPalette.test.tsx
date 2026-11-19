// @vitest-environment happy-dom
/**
 * ⌘K, once its chunk is here, opens in the render that asked for it.
 *
 * The palette is a chunk of its own, preloaded beside the overlay chunk so that it has
 * normally arrived before anybody presses ⌘K. Drawn through `lazy()` alone, that preload
 * bought less than it looked: React suspends on a lazy component's first render however
 * settled its import is, and holds the retry back for up to 300ms after the empty fallback
 * — so the session's first ⌘K waited a third of a second for a module that was already
 * there. Every later one did not, which is why only a first opening shows it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Suspense, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CommandPalette, loadPalette } from './lazyPalette.ts';
import { useStore } from '../../lib/store.ts';
import '../../test/overlayChunk.ts';

// Here before the first case, as the idle preload has it here before the first ⌘K.
await loadPalette();

afterEach(cleanup);

/** Workspace's mount, reduced to the part that matters: the palette under a Suspense. */
function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Search
      </button>
      {open && (
        <Suspense fallback={null}>
          <CommandPalette onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}

describe('the palette’s chunk', () => {
  it('draws the first palette after it has arrived in the render that opens it', () => {
    useStore.setState({
      channels: { c1: { id: 'c1', kind: 'public', name: 'design', archivedAt: null } },
      users: {},
      currentUser: { id: 'u1', displayName: 'Me', prefs: {} },
    } as never);
    render(<Host />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByRole('combobox', { name: /^Search everything/ })).toBeTruthy();
  });
});
