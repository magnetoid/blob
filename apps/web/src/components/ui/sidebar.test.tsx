// @vitest-environment happy-dom
/**
 * shadcn's sidebar as Blob keeps it: the copied component, changed where Blob needed it.
 *
 * Below 768px the sidebar is a Sheet, and the Sheet is Base UI's dialog, so it comes from
 * the overlay chunk like every other dialog (`lib/overlays.ts`): the chat shell draws its
 * sidebar at first paint, and a static Sheet would put Base UI's overlay code in front of
 * every first load. What this pins is that it does, that a press before the chunk lands is
 * not lost, that the Sheet still behaves as one — Escape closes it, and focus goes back to
 * the button that opened it — and that a chunk that never came is asked for again on the
 * next opening rather than on every render while the sheet is shut.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OverlayModule } from '../../lib/overlays.ts';
// The chunk itself, evaluated while the file is collected rather than inside the test,
// where its second or so of evaluation would count against the test's timeout.
import * as overlayChunk from '../overlays/index.ts';

vi.mock('../../lib/overlays.ts', () => ({
  loadOverlays: vi.fn(),
  loadedOverlays: vi.fn(() => null),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A promise settled from outside: the chunk, still on the wire. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A phone: the sidebar's breakpoint is read from the media query, as the stylesheet's is. */
function narrow() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query.includes('max-width'),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

/**
 * The sidebar on a phone with its chunk not yet here, and the means to land it.
 * `lazyOverlay` keeps what its import answered for good, so each case loads the sidebar
 * afresh.
 */
async function aSidebarOnAPhone() {
  narrow();
  vi.resetModules();
  const overlays = await import('../../lib/overlays.ts');
  const { Sidebar, SidebarProvider, SidebarTrigger } = await import('./sidebar.tsx');
  let landed: OverlayModule | null = null;
  vi.mocked(overlays.loadedOverlays).mockImplementation(() => landed);

  render(
    <SidebarProvider>
      <SidebarTrigger aria-label="Open the channel list" />
      <Sidebar label="Channel list" closeLabel="Close the channel list">
        <nav aria-label="Channels">
          <a href="/c/general">general</a>
        </nav>
      </Sidebar>
    </SidebarProvider>,
  );
  return {
    loadOverlays: vi.mocked(overlays.loadOverlays),
    trigger: screen.getByRole('button', { name: 'Open the channel list' }),
    /** The chunk arrives, and from then on it is here, as `loadedOverlays` says in the app. */
    land: (chunk: ReturnType<typeof deferred<OverlayModule>>) => {
      landed = overlayChunk;
      chunk.resolve(overlayChunk);
    },
  };
}

describe('the sidebar below 768px', () => {
  it('opens the mobile Sheet through the overlay chunk and hands focus back to its opener on Escape', async () => {
    const chunk = deferred<OverlayModule>();
    const page = await aSidebarOnAPhone();
    page.loadOverlays.mockReturnValue(chunk.promise);

    // Closed, nothing of the Sheet is asked for: the page paints without the chunk.
    expect(page.loadOverlays).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: 'Channels' })).toBeNull();

    fireEvent.click(page.trigger);

    // Asked for, not yet drawn: the chunk is still on its way.
    expect(page.loadOverlays).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    await act(async () => page.land(chunk));

    // The press was held: the Sheet is open, named, and holds the list.
    const sheet = await screen.findByRole('dialog', { name: 'Channel list' });
    expect(sheet.contains(screen.getByRole('navigation', { name: 'Channels' }))).toBe(true);
    expect(sheet.contains(screen.getByRole('button', { name: 'Close the channel list' }))).toBe(
      true,
    );
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Back on the button that opened it — not on <body>, which is where a click that does
    // not focus its button (Safari's) would otherwise leave it.
    expect(document.activeElement).toBe(page.trigger);
    expect(page.loadOverlays).toHaveBeenCalledTimes(1);
  });

  it('asks for a chunk that failed again on the next opening, and not while the sheet is shut', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const retry = deferred<OverlayModule>();
    const page = await aSidebarOnAPhone();
    page.loadOverlays
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockReturnValueOnce(retry.promise);

    fireEvent.click(page.trigger);
    await act(async () => {});
    // It drew nothing, and the page is still there.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(page.loadOverlays).toHaveBeenCalledTimes(1);

    // The same button shuts what never opened. Left mounted, the sheet would try the
    // import again here, on a render that opens nothing.
    fireEvent.click(page.trigger);
    await act(async () => {});
    expect(page.loadOverlays).toHaveBeenCalledTimes(1);

    // Opened again: a fresh attempt, and this time it lands.
    fireEvent.click(page.trigger);
    expect(page.loadOverlays).toHaveBeenCalledTimes(2);
    await act(async () => page.land(retry));
    expect(await screen.findByRole('dialog', { name: 'Channel list' })).toBeTruthy();
  });
});
