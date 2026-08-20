/**
 * The theme editor.
 *
 * Edits are previewed on the live UI rather than in a mock frame — the fastest way to
 * see whether a palette actually works is to look at the app wearing it. Nothing is
 * saved until you press Save, and Cancel puts the previous palette back.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Theme } from '@blob/shared';
import { api, ApiError } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';
import { applyTheme, pickTheme, previewTokens } from '../../lib/theme.ts';

/** Built-in defaults, read off the document so the editor starts from the real values. */
function currentValue(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return normalizeColor(value) || '#000000';
}

/** <input type="color"> only accepts #rrggbb, so rgb()/short hex is converted. */
function normalizeColor(value: string): string {
  const text = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text
      .slice(1)
      .split('')
      .map((c) => c + c)
      .join('')}`.toLowerCase();
  }
  const rgb = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) {
    const hex = rgb
      .slice(1, 4)
      .map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, '0'))
      .join('');
    return `#${hex}`;
  }
  return '';
}

export function ThemesSection({ onError }: { onError: (message: string | null) => void }) {
  const themes = useStore((s) => s.themes);
  const prefs = useStore((s) => s.currentUser?.prefs);

  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<Theme | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'light' | 'dark'>('light');
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.themes
      .list()
      .then((r) => {
        setGroups(r.groups);
        useStore.setState({ themes: r.themes });
      })
      .catch(() => onError('Could not load themes.'));
  }, [onError]);

  /** Put the user's own palette back after a preview. */
  const restore = useCallback(() => {
    if (prefs) applyTheme(pickTheme(useStore.getState().themes, prefs), prefs.theme);
  }, [prefs]);

  function startEdit(theme: Theme, duplicate: boolean) {
    setEditing(duplicate ? { ...theme, id: '', isPreset: false } : theme);
    setName(duplicate ? `${theme.name} copy` : theme.name);
    setMode(theme.mode);
    setTokens({ ...theme.tokens });
  }

  function stopEdit() {
    setEditing(null);
    setTokens({});
    restore();
  }

  function setToken(token: string, value: string) {
    const next = { ...tokens, [token]: value };
    setTokens(next);
    previewTokens({ [token]: value });
  }

  async function save() {
    setSaving(true);
    onError(null);
    try {
      await api.themes.save({
        id: editing?.id || undefined,
        name: name.trim(),
        mode,
        tokens,
      });
      const listed = await api.themes.list();
      useStore.setState({ themes: listed.themes });
      setEditing(null);
      setTokens({});
      restore();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Could not save that theme.');
    } finally {
      setSaving(false);
    }
  }

  const editableGroups = useMemo(() => Object.entries(groups), [groups]);

  if (editing) {
    return (
      <section>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 6 }}>
          <label className="field" style={{ maxWidth: 240, flex: 1 }}>
            <span className="field-label">Theme name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Mode</span>
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'light' | 'dark')}
            >
              <option value="light">light</option>
              <option value="dark">dark</option>
            </select>
          </label>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn" onClick={stopEdit}>
            Cancel
          </button>
        </div>
        <p className="pref-hint" style={{ marginBottom: 18 }}>
          Changes preview on this window as you make them. Nothing is stored until you save.
          Note that <code>--accent-hover</code> darkens in light themes and lightens in dark
          ones, so it is set explicitly rather than derived.
        </p>

        {editableGroups.map(([group, groupTokens]) => (
          <div key={group} style={{ marginTop: 18 }}>
            <h3 className="section-label" style={{ paddingLeft: 0 }}>
              {group}
            </h3>
            <div className="token-grid">
              {groupTokens.map((token) => (
                <label className="token-row" key={token}>
                  <input
                    type="color"
                    value={normalizeColor(tokens[token] ?? '') || currentValue(token)}
                    onChange={(e) => setToken(token, e.target.value)}
                    aria-label={token}
                  />
                  <span className="token-name">{token.replace(/^--/, '')}</span>
                  {tokens[token] && (
                    <button
                      className="btn btn-ghost"
                      title="Reset to the built-in value"
                      onClick={(e) => {
                        e.preventDefault();
                        const next = { ...tokens };
                        delete next[token];
                        setTokens(next);
                        restore();
                      }}
                    >
                      ↺
                    </button>
                  )}
                </label>
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  }

  return (
    <section>
      <p className="pref-hint" style={{ marginBottom: 16 }}>
        Presets ship with the app and cannot be edited — duplicate one to start from it.
        People choose their own light and dark palettes in Preferences.
      </p>

      <div className="admin-table">
        {themes.map((theme) => (
          <div className="admin-row" key={theme.id}>
            <span
              className="swatch"
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: theme.tokens['--accent'] ?? 'var(--accent)',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="admin-row-title">
                {theme.name}
                <span className="role-pill" data-muted={theme.mode === 'light' ? undefined : true}>
                  {theme.mode}
                </span>
                {theme.isPreset && (
                  <span className="role-pill" data-muted>
                    preset
                  </span>
                )}
              </div>
              <div className="admin-row-meta">
                {Object.keys(theme.tokens).length === 0
                  ? 'The built-in palette, unchanged'
                  : `${Object.keys(theme.tokens).length} tokens overridden`}
              </div>
            </div>
            <div className="admin-row-actions">
              <button className="btn btn-ghost" onClick={() => startEdit(theme, true)}>
                Duplicate
              </button>
              {!theme.isPreset && (
                <>
                  <button className="btn" onClick={() => startEdit(theme, false)}>
                    Edit
                  </button>
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!confirm(`Delete “${theme.name}”?`)) return;
                      try {
                        await api.themes.remove(theme.id);
                        const listed = await api.themes.list();
                        useStore.setState({ themes: listed.themes });
                      } catch (err) {
                        onError(err instanceof ApiError ? err.message : 'Could not delete it.');
                      }
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
