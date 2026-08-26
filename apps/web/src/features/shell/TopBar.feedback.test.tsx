// @vitest-environment happy-dom
/** Reporting a bug, from the corner.
 *
 * The whole feature was already here — `diagnostics.ts` wraps the console into a ring
 * buffer, serialises the page as the reporter saw it, and the instance console renders
 * that snapshot back and closes the ticket. Its only way in was the last row of the
 * account menu, under a disabled "Update — Soon".
 *
 * That matters more than a normal discoverability problem, because of *when* the
 * capture happens: the log and the snapshot are taken the moment the dialog opens, so a
 * report is worth most at the instant something goes wrong. A click and a menu-scan
 * later, the page has often moved on from the thing being described.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const currentUser = {
  id: 'u1',
  displayName: 'Ana',
  email: 'ana@example.com',
  role: 'member',
  avatarUrl: null,
};

vi.mock('../../lib/store.ts', () => ({
  useStore: (select: (state: unknown) => unknown) =>
    select({ currentUser, workspaceName: 'Acme', status: 'online' }),
}));

vi.mock('../../lib/router.ts', () => ({
  navigate: vi.fn(),
  usePath: () => '/',
}));

vi.mock('./WorkspaceSwitcher.tsx', () => ({
  WorkspaceSwitcher: ({ name }: { name: string }) => <div>{name}</div>,
}));

const { TopBar } = await import('./TopBar.tsx');

function renderBar() {
  const onFeedback = vi.fn();
  render(<TopBar onFeedback={onFeedback} view="messages" />);
  return { onFeedback };
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('the feedback control', () => {
  it('is in the corner, not behind a menu', () => {
    const { onFeedback } = renderBar();

    // Present without opening anything: the capture is only as good as how quickly it
    // can be reached from the screen that went wrong.
    fireEvent.click(screen.getByTitle('Report a bug or send feedback'));
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });

  it('is offered to everybody, not only admins', () => {
    // The people most likely to hit a bug are the ones who cannot open the console
    // where the ticket lands.
    renderBar();
    expect(screen.getByTitle('Report a bug or send feedback')).toBeTruthy();
  });

  it('stays in the account menu as well', () => {
    const { onFeedback } = renderBar();
    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Ana/ }));

    // Adding a way in, the way Administration did in the sidebar — not moving the one
    // somebody may already have learned.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Feedback' }));
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });
});
