/** Preferences: theme, density, notification keywords, quiet hours, sign out. */

import { useState } from 'react';
import { api } from '../../lib/api.ts';
import { useStore } from '../../lib/store.ts';

const THEMES = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
] as const;

const DENSITIES = [
  { label: 'Comfortable', value: 'comfortable' },
  { label: 'Compact', value: 'compact' },
  { label: 'Airy', value: 'airy' },
] as const;

export function SettingsView({ onSignedOut }: { onSignedOut: () => void }) {
  const currentUser = useStore((s) => s.currentUser);
  const setPrefs = useStore((s) => s.setPrefs);
  const reset = useStore((s) => s.reset);

  const [keywordDraft, setKeywordDraft] = useState('');
  const prefs = currentUser?.prefs;
  if (!prefs) return null;

  const dnd = prefs.dnd ?? { enabled: false, startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] };

  return (
    <div className="pane">
      <div style={{ overflowY: 'auto' }}>
        <div style={{ maxWidth: 620, padding: '44px 26px 60px' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 600, letterSpacing: '-0.02em' }}>
            Preferences
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 'var(--text-row)', color: 'var(--text-4)' }}>
            Signed in as {currentUser.displayName} · {currentUser.email}
          </p>

          <h2 className="section-label" style={{ marginTop: 32, paddingLeft: 0 }}>
            Theme
          </h2>
          <div className="chip-row">
            {THEMES.map((theme) => (
              <button
                key={theme.value}
                className="chip"
                aria-pressed={prefs.theme === theme.value}
                onClick={() => void setPrefs({ theme: theme.value })}
              >
                {theme.label}
              </button>
            ))}
          </div>

          <h2 className="section-label" style={{ marginTop: 26, paddingLeft: 0 }}>
            Density
          </h2>
          <div className="chip-row">
            {DENSITIES.map((density) => (
              <button
                key={density.value}
                className="chip"
                aria-pressed={prefs.density === density.value}
                onClick={() => void setPrefs({ density: density.value })}
              >
                {density.label}
              </button>
            ))}
          </div>

          <h2 className="section-label" style={{ marginTop: 26, paddingLeft: 0 }}>
            Notifications
          </h2>

          <div className="pref-row">
            <div style={{ flex: 1 }}>
              <div className="pref-label">Enter sends a message</div>
              <div className="pref-hint">
                When off, Enter starts a new line and ⌘Enter sends instead.
              </div>
            </div>
            <button
              className="toggle"
              aria-pressed={prefs.enterToSend}
              aria-label="Enter sends a message"
              onClick={() => void setPrefs({ enterToSend: !prefs.enterToSend })}
            >
              <span />
            </button>
          </div>

          <div className="pref-row">
            <div style={{ flex: 1 }}>
              <div className="pref-label">Quiet hours</div>
              <div className="pref-hint">
                Outside {String(dnd.startHour).padStart(2, '0')}:00–
                {String(dnd.endHour).padStart(2, '0')}:00 nothing will notify you. Unread counts
                still update.
              </div>
            </div>
            <button
              className="toggle"
              aria-pressed={dnd.enabled}
              aria-label="Quiet hours"
              onClick={() => void setPrefs({ dnd: { ...dnd, enabled: !dnd.enabled } })}
            >
              <span />
            </button>
          </div>

          <div style={{ padding: '17px 0', borderBottom: '1px solid var(--hairline-soft)' }}>
            <div className="pref-label">Keyword alerts</div>
            <div className="pref-hint">
              Notify me whenever one of these words appears anywhere I can see.
            </div>
            <div className="chip-row" style={{ marginTop: 10 }}>
              {prefs.keywords.map((keyword) => (
                <button
                  key={keyword}
                  className="chip"
                  aria-pressed
                  title="Remove"
                  onClick={() =>
                    void setPrefs({ keywords: prefs.keywords.filter((k) => k !== keyword) })
                  }
                >
                  {keyword} ✕
                </button>
              ))}
            </div>
            <form
              style={{ display: 'flex', gap: 8, marginTop: 12 }}
              onSubmit={(event) => {
                event.preventDefault();
                const word = keywordDraft.trim();
                if (!word || prefs.keywords.includes(word)) return;
                void setPrefs({ keywords: [...prefs.keywords, word] });
                setKeywordDraft('');
              }}
            >
              <input
                className="input"
                value={keywordDraft}
                onChange={(e) => setKeywordDraft(e.target.value)}
                placeholder="Add a word"
                style={{ maxWidth: 240 }}
              />
              <button className="btn" type="submit">
                Add
              </button>
            </form>
          </div>

          <h2 className="section-label" style={{ marginTop: 26, paddingLeft: 0 }}>
            Account
          </h2>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button
              className="btn"
              onClick={async () => {
                await api.auth.logout();
                reset();
                onSignedOut();
              }}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
