// @vitest-environment happy-dom
/** The frame both consoles share. What these pin: the body re-mounts when the section
 * changes — that is what plays the page's one entrance, once per page — and not when a
 * detail opens inside a section; an error belongs to the page that raised it; and on a
 * narrow screen the nav is a sheet that closes when it has done its job, by a choice or by
 * Escape, and hands focus back to what opened it. */
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { NavGroup } from './registry.ts';

// The bar is another feature's, with a store behind it; this is about the page under it.
vi.mock('../shell/TopBar.tsx', () => ({
  TopBar: () => <header className="topbar">top bar</header>,
}));

const { ConsoleShell } = await import('./ConsoleShell.tsx');

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

let mounts = 0;

function Probe({ onError }: { onError: (message: string | null) => void }) {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <button onClick={() => onError('That did not work.')}>Fail</button>;
}

const GROUPS: NavGroup[] = [
  {
    id: 'rows',
    sections: [
      { id: 'general', label: 'General' },
      { id: 'audit', label: 'Audit log' },
    ],
  },
];

function shell(section: string, resetKey?: string, groups: NavGroup[] = []) {
  return (
    <ConsoleShell
      view="admin"
      navId="nav"
      nav={{ groups, basePath: '/admin', title: 'This server', subtitle: '' }}
      section={section}
      viewer={{ role: 'owner', isInstanceAdmin: true }}
      title="A page"
      resetKey={resetKey}
      onFeedback={vi.fn()}
    >
      {(onError) => <Probe onError={onError} />}
    </ConsoleShell>
  );
}

/** The page's body: the part the section is drawn in. */
const body = () => screen.getByRole('button', { name: 'Fail' }).closest('[data-slot="console-body"]');

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

describe('the console frame', () => {
  it('starts the page body over when the section changes', () => {
    mounts = 0;
    const { rerender } = render(shell('general'));
    expect(mounts).toBe(1);
    const first = body();
    // The entrance is the body's own: a fade, and a lift by the token reduced motion zeroes.
    expect(first?.className).toMatch(/\banimate-in\b/);
    expect(first?.className).toMatch(/\bfade-in\b/);
    expect(first?.className).toContain('slide-in-from-bottom-(length:--motion-slide)');

    rerender(shell('channels'));
    expect(mounts).toBe(2);
    // A new element, so the entrance plays again.
    expect(body()).not.toBe(first);
  });

  // Apps → one app is the same section with a detail id, and must not replay the
  // entrance or throw away what the section was holding.
  it('keeps the body when only the detail changes', () => {
    mounts = 0;
    const { rerender } = render(shell('apps', 'apps/'));
    const first = body();
    rerender(shell('apps', 'apps/p1'));
    expect(mounts).toBe(1);
    expect(body()).toBe(first);
  });

  it('shows an error in its own slot, and clears it when the page changes', () => {
    const { rerender } = render(shell('apps', 'apps/'));
    fireEvent.click(screen.getByRole('button', { name: 'Fail' }));

    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('That did not work.');
    expect(error.className).toContain('text-destructive');
    // About the page, not inside the section that raised it.
    expect(body()?.contains(error)).toBe(false);

    rerender(shell('apps', 'apps/p1'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // e2e and axe wait for `.admin-main` before they look at a console page.
  it('draws the page in the main landmark the end-to-end tests wait for', () => {
    render(shell('general'));
    const main = screen.getByRole('main');
    expect(main.classList.contains('admin-main')).toBe(true);
    expect(screen.getByRole('heading', { level: 1, name: 'A page' })).toBeTruthy();
    expect(main.contains(body())).toBe(true);
  });

  // The bar is legacy markup inside the sidebar's provider, which is a shadcn component, so
  // the preflight repair reaches it only through an island (styles/app/base.css).
  it('keeps the top bar a legacy island', () => {
    render(shell('general'));
    expect(screen.getByRole('banner').closest('[data-legacy]')).not.toBeNull();
  });

  // Every section is converted, so the body is no island: preflight holds in it as in any
  // shadcn component. It is also why an island a section still keeps inside a card works —
  // base.css's island clause cannot reach one inside a component inside another island.
  it('draws the page body as converted markup, not as a legacy island', () => {
    render(shell('general'));
    expect(body()).not.toBeNull();
    expect(body()?.closest('[data-legacy]')).toBeNull();
    expect(screen.getByRole('main').querySelector('[data-legacy]')).toBeNull();
  });
});

describe('the section menu on a narrow screen', () => {
  it('opens the section menu as a sheet below 768px and closes it when a section is chosen', async () => {
    narrow();
    render(shell('general', undefined, GROUPS));
    // Closed, the nav is not on the page at all, so its rows are not in the tab order.
    expect(screen.queryByRole('navigation', { name: 'Console sections' })).toBeNull();

    const trigger = screen.getByRole('button', { name: 'Open the section menu' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);

    const sheet = await screen.findByRole('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(sheet.contains(screen.getByRole('navigation', { name: 'Console sections' }))).toBe(
      true,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Audit log' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.pathname).toBe('/admin/audit');
    // Focus is in the page, on the button that opened the menu — not dropped on <body>
    // with the sheet it was in.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(screen.getByRole('main').contains(document.activeElement)).toBe(true);
  });

  it('closes the sheet on Escape and puts focus back on the trigger', async () => {
    narrow();
    // Stands in for the shell's own shortcuts (`app/Workspace.tsx`), which listen on
    // `window` and take a stray Escape as "close the thread" or "mark this channel read".
    const shellHeard = vi.fn();
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') shellHeard();
    };
    window.addEventListener('keydown', onWindowKey);

    try {
      render(shell('general', undefined, GROUPS));
      const trigger = screen.getByRole('button', { name: 'Open the section menu' });
      // Not focused first: a click does not focus a button in Safari, any more than it
      // does here, so "whatever had focus before" would be the page.
      fireEvent.click(trigger);
      const sheet = await screen.findByRole('dialog');
      await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(document.activeElement).toBe(trigger);
      // One Escape, one layer: the page is still there, and nothing behind the sheet heard
      // the key.
      expect(shellHeard).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Fail' })).toBeTruthy();
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
