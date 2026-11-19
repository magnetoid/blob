// @vitest-environment happy-dom
/**
 * ⌘K is a chunk of its own, and has to arrive without breaking anything.
 *
 * Two promises. Once the chunk is here — the idle preload has normally seen to that before
 * anybody presses ⌘K — the palette opens in the render that asked for it; drawn through
 * `lazy()`, the session's first ⌘K waited up to 300ms for a module that was already there,
 * because React suspends on a lazy's first render however settled its import is. And a
 * chunk that will not load costs the palette and nothing else: a toast, a closed palette,
 * the workspace still standing, and the next ⌘K tries again. A `lazy()` would have thrown
 * to the app's error boundary — "Something broke" for a key press — and kept the failure
 * until a reload.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ComponentType } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette, loadPalette } from './lazyPalette.ts';
import { ErrorBoundary } from '../../components/ErrorBoundary.tsx';
import { useStore } from '../../lib/store.ts';
import '../../test/overlayChunk.ts';

vi.mock('../../lib/clientErrors.ts', () => ({ reportClientError: vi.fn() }));

// Here before the first case, as the idle preload has it here before the first ⌘K.
await loadPalette();

afterEach(() => {
  cleanup();
  vi.doUnmock('./CommandPalette.tsx');
  vi.restoreAllMocks();
});

type Palette = ComponentType<{ onClose: () => void }>;

/** Workspace's mount, reduced to the part that matters: the palette while it is open. */
function Host({ Palette, onClose }: { Palette: Palette; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ErrorBoundary>
      <p>the workspace</p>
      <button type="button" onClick={() => setOpen(true)}>
        Search
      </button>
      {open && (
        <Palette
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
        />
      )}
    </ErrorBoundary>
  );
}

describe('the palette’s chunk', () => {
  it('draws the first palette after it has arrived in the render that opens it', () => {
    useStore.setState({
      channels: { c1: { id: 'c1', kind: 'public', name: 'design', archivedAt: null } },
      users: {},
      currentUser: { id: 'u1', displayName: 'Me', prefs: {} },
    } as never);
    render(<Host Palette={CommandPalette} />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(screen.getByRole('combobox', { name: /^Search everything/ })).toBeTruthy();
  });

  it('costs only the palette when its chunk will not load, and tries again on the next ⌘K', async () => {
    // A module registry of its own, so this case starts with nothing arrived and nothing
    // pending, and a palette module that fails until it is told otherwise.
    const chunk = { fails: true, tries: 0 };
    vi.resetModules();
    vi.doMock('./CommandPalette.tsx', async () => {
      chunk.tries += 1;
      if (chunk.fails) throw new TypeError('Failed to fetch dynamically imported module');
      const { createElement } = await import('react');
      return { default: () => createElement('p', null, 'the palette') };
    });
    const fresh = await import('./lazyPalette.ts');
    const { useToasts } = await import('../../lib/toasts.ts');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onClose = vi.fn();
    render(<Host Palette={fresh.CommandPalette} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByText('the workspace')).toBeTruthy();
    expect(screen.queryByText('Something broke')).toBeNull();
    expect(useToasts.getState().toasts).toEqual([
      expect.objectContaining({ kind: 'error', text: 'Couldn’t open search. Try again.' }),
    ]);
    expect(consoleError).toHaveBeenCalledWith('palette failed to load', expect.any(Error));
    expect(screen.queryByText('the palette')).toBeNull();

    // The chunk is reachable again: the next ⌘K fetches it rather than replaying the failure.
    chunk.fails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('the palette')).toBeTruthy();
    expect(chunk.tries).toBe(2);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText('the workspace')).toBeTruthy();
  });
});
