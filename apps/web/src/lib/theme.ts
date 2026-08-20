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

/** Which mode applies right now, resolving 'system' against the OS. */
export function resolveMode(preference: UserPrefs['theme']): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function pickTheme(
  themes: Theme[],
  prefs: Pick<UserPrefs, 'theme' | 'themeLight' | 'themeDark'>,
): ThemeChoice {
  const mode = resolveMode(prefs.theme);
  const wanted = mode === 'dark' ? prefs.themeDark : prefs.themeLight;
  const match =
    themes.find((t) => t.slug === wanted && t.mode === mode) ??
    themes.find((t) => t.mode === mode);
  return { mode, tokens: match?.tokens ?? {} };
}

let applied: string[] = [];

/**
 * Write a theme onto the document.
 *
 * Tokens set by a previous theme are removed first, so switching from a heavily
 * customised palette back to a sparse one does not leave the old values behind.
 */
export function applyTheme(choice: ThemeChoice, preference: UserPrefs['theme']): void {
  const root = document.documentElement;

  for (const name of applied) {
    if (!(name in choice.tokens)) root.style.removeProperty(name);
  }
  for (const [name, value] of Object.entries(choice.tokens)) {
    root.style.setProperty(name, value);
  }
  applied = Object.keys(choice.tokens);

  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);

  // Native controls and scrollbars follow color-scheme, not our tokens.
  root.style.colorScheme = choice.mode;

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ preference, mode: choice.mode, tokens: choice.tokens }),
    );
  } catch {
    // Private browsing or a full quota: the theme still applies, it just flashes
    // on the next load.
  }
}

/** Preview without persisting — used by the theme editor while you drag a picker. */
export function previewTokens(tokens: Record<string, string>): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
  applied = [...new Set([...applied, ...Object.keys(tokens)])];
}
