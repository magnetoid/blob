// @vitest-environment happy-dom
/**
 * Settings → Preferences → palettes: a radio group of tiles, each drawn in the theme's own
 * colours — read from shadcn's names, and from b0 where a theme sets none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DEFAULT_PREFS, type Theme, type UserPrefs } from '@blob/shared';
import { useStore } from '../../lib/store.ts';
import { PreferencesCard } from './PreferencesCard.tsx';

function theme(slug: string, mode: Theme['mode'], tokens: Record<string, string>): Theme {
  return { id: slug, slug, name: slug, mode, tokens, isPreset: true, isEnabled: true };
}

/** A save that went through: the choice lands in the user, which the group draws from. */
const setPrefs = vi.fn(async (patch: Partial<UserPrefs>) => {
  useStore.setState((s) => ({
    currentUser: s.currentUser && {
      ...s.currentUser,
      prefs: { ...s.currentUser.prefs, ...patch },
    },
  }));
});

beforeEach(() => {
  useStore.setState({
    currentUser: { id: 'me', displayName: 'Ana', prefs: { ...DEFAULT_PREFS } } as never,
    setPrefs,
    translationEnabled: false,
    themes: [
      theme('linen', 'light', {
        '--background': '#fbf8f3',
        '--sidebar': '#f4eee3',
        '--muted': '#f6f1e8',
        '--primary': '#7a4f22',
        // The names the stylesheet used before shadcn mean nothing to a tile now.
        '--bg': '#ff0000',
        '--accent': '#ff0000',
      }),
      theme('paper', 'light', {}),
      theme('midnight', 'dark', {}),
      theme('ember', 'dark', {}),
    ],
  } as never);
});

afterEach(() => {
  cleanup();
  setPrefs.mockClear();
});

/** The four colours a tile carries, as the custom properties its swatch is painted from. */
function swatch(name: string) {
  const style = screen.getByRole('radio', { name }).style;
  return {
    page: style.getPropertyValue('--swatch-page'),
    rail: style.getPropertyValue('--swatch-rail'),
    line: style.getPropertyValue('--swatch-line'),
    primary: style.getPropertyValue('--swatch-primary'),
  };
}

describe('the palette gallery', () => {
  it('is a radio group for each mode, named for it, with the chosen palette checked', () => {
    render(<PreferencesCard />);

    const light = screen.getByRole('radiogroup', { name: 'Light palette' });
    expect(within(light).getAllByRole('radio').map((tile) => tile.textContent)).toEqual([
      'linen',
      'paper',
    ]);
    expect(within(light).getByRole('radio', { name: 'paper' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(within(light).getByRole('radio', { name: 'linen' }).getAttribute('aria-checked')).toBe(
      'false',
    );

    const dark = screen.getByRole('radiogroup', { name: 'Dark palette' });
    expect(within(dark).getByRole('radio', { name: 'midnight' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it("draws a tile from the theme's page, sidebar, muted and primary colours", () => {
    render(<PreferencesCard />);

    expect(swatch('linen')).toEqual({
      page: '#fbf8f3',
      rail: '#f4eee3',
      line: '#f6f1e8',
      primary: '#7a4f22',
    });
  });

  it("draws a theme that sets nothing in b0's colours for its mode", () => {
    render(<PreferencesCard />);

    expect(swatch('paper')).toEqual({
      page: '#ffffff',
      rail: '#fafafa',
      line: '#f5f5f5',
      primary: '#171717',
    });
    expect(swatch('midnight')).toEqual({
      page: '#0a0a0a',
      rail: '#171717',
      line: '#262626',
      primary: '#e5e5e5',
    });
  });

  it('keeps the tile’s own colours out of the markup: the swatch reads them from the tile', () => {
    render(<PreferencesCard />);
    // The colours are data on the tile; nothing inside it carries one of its own.
    const tile = screen.getByRole('radio', { name: 'linen' });
    expect(tile.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('chooses a palette on a click', () => {
    render(<PreferencesCard />);
    fireEvent.click(screen.getByRole('radio', { name: 'linen' }));
    expect(setPrefs).toHaveBeenCalledWith({ themeLight: 'linen' });
    expect(screen.getByRole('radio', { name: 'linen' }).getAttribute('aria-checked')).toBe('true');
  });

  it('moves between palettes on the arrow keys, as a radio group does', async () => {
    render(<PreferencesCard />);
    const paper = screen.getByRole('radio', { name: 'paper' });
    paper.focus();

    // The key moves focus and the focus chooses, a render apart.
    fireEvent.keyDown(paper, { key: 'ArrowLeft' });
    await waitFor(() => expect(setPrefs).toHaveBeenCalledWith({ themeLight: 'linen' }));
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'linen' }));
    expect(screen.getByRole('radio', { name: 'linen' }).getAttribute('aria-checked')).toBe('true');

    // The other mode's group is its own: a key in one does not reach the other.
    expect(screen.getByRole('radio', { name: 'midnight' }).getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('says so when a mode has no palettes', () => {
    useStore.setState({ themes: [theme('paper', 'light', {})] } as never);
    render(<PreferencesCard />);
    expect(screen.getByText('This workspace has no palettes for this mode yet.')).toBeTruthy();
    expect(screen.queryByRole('radiogroup', { name: 'Dark palette' })).toBeNull();
  });
});
