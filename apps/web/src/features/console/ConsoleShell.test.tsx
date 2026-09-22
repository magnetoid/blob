// @vitest-environment happy-dom
/** The frame both consoles share. What these pin: the body re-mounts when the section
 * changes — that is what plays the page's one entrance, once per page — and not when a
 * detail opens inside a section; and an error belongs to the page that raised it. */
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// The bar is another feature's, with a store behind it; this is about the page under it.
vi.mock('../shell/TopBar.tsx', () => ({ TopBar: () => <div>top bar</div> }));

const { ConsoleShell } = await import('./ConsoleShell.tsx');

afterEach(cleanup);

let mounts = 0;

function Probe({ onError }: { onError: (message: string | null) => void }) {
  useEffect(() => {
    mounts += 1;
  }, []);
  return <button onClick={() => onError('That did not work.')}>Fail</button>;
}

function shell(section: string, resetKey?: string) {
  return (
    <ConsoleShell
      view="admin"
      navId="nav"
      nav={{ groups: [], basePath: '/admin', title: 'This server', subtitle: '' }}
      section={section}
      isOwner
      title="A page"
      toggle={{ className: 'icon-btn admin-nav-toggle', label: 'Sections', icon: null }}
      resetKey={resetKey}
      onFeedback={vi.fn()}
    >
      {(onError) => <Probe onError={onError} />}
    </ConsoleShell>
  );
}

describe('the console frame', () => {
  it('starts the page body over when the section changes', () => {
    mounts = 0;
    const { rerender } = render(shell('general'));
    expect(mounts).toBe(1);

    rerender(shell('channels'));
    expect(mounts).toBe(2);
  });

  // Apps → one app is the same section with a detail id, and must not replay the
  // entrance or throw away what the section was holding.
  it('keeps the body when only the detail changes', () => {
    mounts = 0;
    const { rerender } = render(shell('apps', 'apps/'));
    rerender(shell('apps', 'apps/p1'));
    expect(mounts).toBe(1);
  });

  it('shows an error in its own strip, and clears it when the page changes', () => {
    const { rerender } = render(shell('apps', 'apps/'));
    fireEvent.click(screen.getByRole('button', { name: 'Fail' }));

    const error = screen.getByText('That did not work.');
    expect(error.classList.contains('console-error')).toBe(true);
    expect(error.classList.contains('error-text')).toBe(true);

    rerender(shell('apps', 'apps/p1'));
    expect(screen.queryByText('That did not work.')).toBeNull();
  });
});
