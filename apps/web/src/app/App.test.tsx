// @vitest-environment happy-dom
/**
 * What the root does on mount that is not about who is signed in.
 *
 * It starts fetching the overlay chunk once the page has painted, so the first menu of a
 * session is usually there before anyone reaches for one. Two pages open no overlay at
 * all and are often the whole of a visit — the one-click unsubscribe link in an away email
 * and an assistant's consent question — so they do not pay for it.
 *
 * Everything the screens would do is stubbed; the case is only whether the root asks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { App } from './App.tsx';
import { api } from '../lib/api.ts';
import { preloadOverlays } from '../lib/overlays.ts';

vi.mock('../lib/overlays.ts', () => ({ preloadOverlays: vi.fn() }));
vi.mock('./Workspace.tsx', () => ({ Workspace: () => null }));
vi.mock('../components/Toasts.tsx', () => ({ Toasts: () => null }));
vi.mock('../features/auth/AuthScreen.tsx', () => ({ AuthScreen: () => null }));
vi.mock('../features/auth/ConfirmItsYou.tsx', () => ({ ConfirmItsYou: () => null }));
vi.mock('../features/mail/UnsubscribeScreen.tsx', () => ({ UnsubscribeScreen: () => null }));
vi.mock('../features/oauth/ConsentScreen.tsx', () => ({ ConsentScreen: () => null }));

beforeEach(() => {
  vi.mocked(preloadOverlays).mockReset();
  // Never answers: the root stays on its loading screen, which is all these cases need.
  vi.spyOn(api, 'bootstrap').mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

function openAt(url: string) {
  window.history.replaceState({}, '', url);
  render(<App />);
}

describe('preloading the overlay chunk', () => {
  it('starts once the app has mounted', () => {
    openAt('/');
    expect(preloadOverlays).toHaveBeenCalledTimes(1);
  });

  it('does not on the unsubscribe page, which opens no overlay', () => {
    openAt('/unsubscribe?t=abc123');
    expect(preloadOverlays).not.toHaveBeenCalled();
  });

  it('does not on the consent page, which opens no overlay', () => {
    openAt('/oauth/authorize?client_id=x');
    expect(preloadOverlays).not.toHaveBeenCalled();
  });
});
