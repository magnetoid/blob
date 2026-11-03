// @vitest-environment happy-dom
/** Calls: huddles and video meetups, a tab each, and the URL says which. What these pin is
 * that the tabs are a real tab list (arrow keys move between them, one Tab stop), that the
 * URL follows the tab and the tab follows the URL, and that the panel under it is the
 * one the tab is for. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { navigate, parseRoute, usePath } from '../../../../lib/router.ts';

const DEFAULTS = {
  huddles: { enabled: true, cameras: true, screenShare: true, maxParticipants: 50 },
  meetups: { enabled: true, camerasOnJoin: true, maxParticipants: 12 },
};

const { useStore } = await import('../../../../lib/store.ts');
const { CallsSection } = await import('./CallsSection.tsx');

/** The page as AdminConsole hands it over: the tab is the route's detail id. */
function AtThePath() {
  const route = parseRoute(usePath());
  return (
    <CallsSection
      onError={vi.fn()}
      isOwner={false}
      detailId={route.view === 'admin' ? route.detailId : undefined}
    />
  );
}

function at(path: string) {
  window.history.replaceState(null, '', path);
  return render(<AtThePath />);
}

beforeEach(() => {
  useStore.setState({
    callsAvailable: true,
    callsLoaded: true,
    callSettings: structuredClone(DEFAULTS),
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('Admin → Calls', () => {
  it('opens on Huddles for the bare URL, and shows that kind’s settings under it', () => {
    at('/admin/calls');
    const tabs = screen.getByRole('tablist', { name: 'Kinds of call' });
    expect(within(tabs).getByRole('tab', { name: 'Huddles', selected: true })).toBeTruthy();
    expect(within(tabs).getByRole('tab', { name: 'Video meetups', selected: false })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Allow huddles' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Allow video meetups' })).toBeNull();
  });

  it('opens the tab the URL names', () => {
    at('/admin/calls/meetups');
    expect(screen.getByRole('tab', { name: 'Video meetups', selected: true })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Allow video meetups' })).toBeTruthy();
  });

  it('moves between Huddles and Meetups with the arrow keys and keeps the URL in step', async () => {
    at('/admin/calls/huddles');

    const huddles = screen.getByRole('tab', { name: 'Huddles' });
    const meetups = screen.getByRole('tab', { name: 'Video meetups' });
    // One Tab stop for the list: the chosen tab is in the tab order, the other is reached
    // by arrow.
    expect(huddles.getAttribute('tabindex')).toBe('0');
    expect(meetups.getAttribute('tabindex')).toBe('-1');

    act(() => huddles.focus());
    fireEvent.keyDown(huddles, { key: 'ArrowRight' });
    await waitFor(() => expect(window.location.pathname).toBe('/admin/calls/meetups'));
    expect(screen.getByRole('tab', { name: 'Video meetups', selected: true })).toBeTruthy();
    expect(document.activeElement).toBe(meetups);
    expect(screen.getByRole('switch', { name: 'Allow video meetups' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Allow huddles' })).toBeNull();

    fireEvent.keyDown(meetups, { key: 'ArrowLeft' });
    await waitFor(() => expect(window.location.pathname).toBe('/admin/calls/huddles'));
    expect(screen.getByRole('tab', { name: 'Huddles', selected: true })).toBeTruthy();
    expect(document.activeElement).toBe(huddles);
    expect(screen.getByRole('switch', { name: 'Allow huddles' })).toBeTruthy();
  });

  it('moves to a tab when it is clicked, and when the URL changes under it', async () => {
    at('/admin/calls/huddles');
    fireEvent.click(screen.getByRole('tab', { name: 'Video meetups' }));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/calls/meetups'));
    expect(screen.getByRole('tab', { name: 'Video meetups', selected: true })).toBeTruthy();

    // The browser's Back button, or a link to the other tab: nobody touched the tabs.
    act(() => navigate('/admin/calls/huddles'));
    expect(screen.getByRole('tab', { name: 'Huddles', selected: true })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Allow huddles' })).toBeTruthy();
  });

  it('labels the panel by its tab', () => {
    at('/admin/calls/meetups');
    const tab = screen.getByRole('tab', { name: 'Video meetups' });
    const panel = screen.getByRole('tabpanel', { name: 'Video meetups' });
    expect(tab.getAttribute('aria-controls')).toBe(panel.id);
  });

  // Base UI makes an open panel a tab stop, so Tab from the tabs lands on it. A stop with
  // `outline-none` and nothing in its place shows nobody where they are (WCAG 2.4.7); the
  // class is what the kit's other controls draw their focus with.
  it('is a tab stop that shows where focus is when it lands there', () => {
    at('/admin/calls/huddles');
    const panel = screen.getByRole('tabpanel', { name: 'Huddles' });
    expect(panel.getAttribute('tabindex')).toBe('0');
    expect(panel.classList.contains('focus-visible:ring-3')).toBe(true);
    expect(panel.classList.contains('focus-visible:ring-ring/50')).toBe(true);
  });
});
