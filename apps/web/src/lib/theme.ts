/**
 * Applying themes.
 *
 * A theme is a set of CSS custom properties written onto `<html>`, so the whole app
 * re-renders in the new palette with no component involvement. Tokens arrive as data
 * from the server, already validated against an allowlist — nothing here injects CSS
 * text.
 *
 * `App.tsx` remains the single place that stamps the document; this module holds the
 * mechanics so a live preview in the theme editor can reuse them.
 */

import type { Theme, UserPrefs } from '@blob/shared';

/** Mirrors the chosen palette so the pre-hydration script can avoid a flash. */
const STORAGE_KEY = 'blob.theme';

export interface ThemeChoice {
  mode: 'light' | 'dark';
  tokens: Record<string, string>;
}

export interface ThemeChoices {
  light: ThemeChoice;
  dark: ThemeChoice;
}

/** Which mode applies right now, resolving 'system' against the OS. */
export function resolveMode(preference: UserPrefs['theme']): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function pickThemeForMode(
  themes: Theme[],
  prefs: Pick<UserPrefs, 'theme' | 'themeLight' | 'themeDark'>,
  mode: 'light' | 'dark',
): ThemeChoice {
  const wanted = mode === 'dark' ? prefs.themeDark : prefs.themeLight;
  const enabled = themes.filter((theme) => theme.isEnabled);
  const match =
    enabled.find((theme) => theme.slug === wanted && theme.mode === mode) ??
    enabled.find((theme) => theme.mode === mode);
  return { mode, tokens: match?.tokens ?? {} };
}

export function themeChoices(
  themes: Theme[],
  prefs: Pick<UserPrefs, 'theme' | 'themeLight' | 'themeDark'>,
): ThemeChoices {
  return {
    light: pickThemeForMode(themes, prefs, 'light'),
    dark: pickThemeForMode(themes, prefs, 'dark'),
  };
}

export function pickTheme(
  themes: Theme[],
  prefs: Pick<UserPrefs, 'theme' | 'themeLight' | 'themeDark'>,
): ThemeChoice {
  return themeChoices(themes, prefs)[resolveMode(prefs.theme)];
}

let applied: string[] = [];

function writeTheme(choice: ThemeChoice, preference: UserPrefs['theme']): void {
  const root = document.documentElement;
  const bootTokens = (root.dataset.themeTokens ?? '')
    .split(' ')
    .filter(Boolean);

  for (const name of new Set([...applied, ...bootTokens])) {
    if (!(name in choice.tokens)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(choice.tokens)) {
    root.style.setProperty(name, value);
  }
  applied = Object.keys(choice.tokens);
  root.dataset.themeTokens = applied.join(' ');
  root.dataset.resolvedTheme = choice.mode;

  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);

  // Native controls and scrollbars follow color-scheme, not our tokens.
  root.style.colorScheme = choice.mode;
  const accent =
    choice.tokens['--accent'] ??
    (choice.mode === 'dark' ? '#5fb287' : '#1f5c3d');
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute('content', accent);
}

/**
 * Write and persist a theme.
 *
 * Tokens set by a previous theme are removed first, so switching from a heavily
 * customised palette back to a sparse one does not leave the old values behind.
 */
export function applyTheme(
  choice: ThemeChoice,
  preference: UserPrefs['theme'],
  choices?: ThemeChoices,
): void {
  writeTheme(choice, preference);

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        preference,
        mode: choice.mode,
        tokens: choice.tokens,
        palettes: choices
          ? { light: choices.light.tokens, dark: choices.dark.tokens }
          : undefined,
      }),
    );
  } catch {
    // Private browsing or a full quota: the theme still applies, it just flashes
    // on the next load.
  }
}

/** Preview a complete palette without replacing the user's persisted choice. */
export function previewTheme(choice: ThemeChoice): void {
  writeTheme(choice, choice.mode);
}
