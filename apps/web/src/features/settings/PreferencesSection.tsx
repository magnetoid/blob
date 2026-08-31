/** How this account looks and behaves.
 *
 * Was `/settings`, a page of its own with its own layout. It is a section of the
 * workspace page now — same nav, same header, same shell as everything else you can
 * configure — because "settings" being two differently-shaped screens was the confusing
 * part, not where any individual control lived.
 *
 * Everything here is *yours*, so it is visible to every member. The workspace sections
 * below it are not, and `WorkspaceConsole` is what draws that line.
 */

import { useEffect, useState } from 'react';
import { api, type AuthSession } from '../../lib/api.ts';
import { showError } from '../../lib/toasts.ts';
import { useStore } from '../../lib/store.ts';
import type { AdminSectionProps } from '../admin/AdminConsole.tsx';

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

const LANGUAGES = [
  { label: 'System default', value: '' },
  { label: 'English', value: 'en' },
  { label: 'Serbian', value: 'sr' },
  { label: 'Chinese (Simplified)', value: 'zh' },
  { label: 'German', value: 'de' },
  { label: 'French', value: 'fr' },
  { label: 'Spanish', value: 'es' },
  { label: 'Italian', value: 'it' },
  { label: 'Portuguese', value: 'pt-BR' },
  { label: 'Japanese', value: 'ja' },
  { label: 'Korean', value: 'ko' },
] as const;

export function PreferencesSection({ onSignedOut }: AdminSectionProps) {
  const currentUser = useStore((s) => s.currentUser);
  const setPrefs = useStore((s) => s.setPrefs);
  const themes = useStore((s) => s.themes);
  const reset = useStore((s) => s.reset);

  const prefs = currentUser?.prefs;
  if (!prefs || !currentUser) return null;

  return (
    <section style={{ maxWidth: 620 }}>
      <p className="pref-hint" style={{ marginTop: 0 }}>
        Signed in as {currentUser.displayName} · {currentUser.email}
      </p>

      <h2 className="section-label" style={{ marginTop: 24 }}>
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

      <h2 className="section-label" style={{ marginTop: 26 }}>
        Light palette
      </h2>
      <div className="chip-row">
        {themes
          .filter((t) => t.mode === 'light')
          .map((theme) => (
            <button
              key={theme.id}
              className="chip"
              aria-pressed={prefs.themeLight === theme.slug}
              onClick={() => void setPrefs({ themeLight: theme.slug })}
            >
              <span className="swatch" style={{ background: theme.tokens['--accent'] }} />
              {theme.name}
            </button>
          ))}
      </div>

      <h2 className="section-label" style={{ marginTop: 26 }}>
        Dark palette
      </h2>
      <div className="chip-row">
        {themes
          .filter((t) => t.mode === 'dark')
          .map((theme) => (
            <button
              key={theme.id}
              className="chip"
              aria-pressed={prefs.themeDark === theme.slug}
              onClick={() => void setPrefs({ themeDark: theme.slug })}
            >
              <span className="swatch" style={{ background: theme.tokens['--accent'] }} />
              {theme.name}
            </button>
          ))}
      </div>

      <h2 className="section-label" style={{ marginTop: 26 }}>
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

      <h2 className="section-label" style={{ marginTop: 26 }}>
        Language and input
      </h2>

      <div className="pref-row">
        <div style={{ flex: 1 }}>
          <div className="pref-label">Preferred language</div>
          <div className="pref-hint">
            Message translation uses this as your target language when teammates write in
            another language.
          </div>
        </div>
        <select
          className="input"
          aria-label="Preferred language"
          value={prefs.language ?? ''}
          onChange={(event) =>
            void setPrefs({
              language: event.target.value || null,
              autoTranslate: !!event.target.value && prefs.autoTranslate,
            })
          }
          style={{ maxWidth: 220 }}
        >
          {LANGUAGES.map((language) => (
            <option key={language.value || 'system'} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </div>

      <div className="pref-row">
        <div style={{ flex: 1 }}>
          <div className="pref-label">Auto-translate incoming messages</div>
          <div className="pref-hint">
            Show translated copies inline when your preferred language is set.
          </div>
        </div>
        <button
          className="toggle"
          aria-pressed={prefs.autoTranslate && !!prefs.language}
          aria-label="Auto-translate incoming messages"
          onClick={() =>
            void setPrefs({
              autoTranslate: !!prefs.language && !prefs.autoTranslate,
            })
          }
          disabled={!prefs.language}
          title={prefs.language ? undefined : 'Choose a preferred language first.'}
        >
          <span />
        </button>
      </div>

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

      <h2 className="section-label" style={{ marginTop: 26 }}>
        Where you’re signed in
      </h2>
      <DevicesPanel />

      <h2 className="section-label" style={{ marginTop: 26 }}>
        Account
      </h2>
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button
          className="btn"
          onClick={async () => {
            await api.auth.logout();
            reset();
            onSignedOut?.();
          }}
        >
          Sign out
        </button>
      </div>
    </section>
  );
}

/**
 * Every session this account holds — the standard "was that me?" control. The server
 * has answered `/api/auth/sessions` since the port; this is its first caller.
 */
function DevicesPanel() {
  const [sessions, setSessions] = useState<AuthSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.auth
      .sessions()
      .then((r) => {
        if (!cancelled) setSessions(r.sessions);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load your sessions.');
      });
    return () => {
      cancelled = true;
    };
  }, [revoking]);

  if (error) return <p className="error-text">{error}</p>;
  if (sessions === null) return <p className="pref-hint">Loading…</p>;

  const others = sessions.filter((s) => !s.current);
  return (
    <div style={{ marginTop: 12 }}>
      {sessions.map((session) => (
        <div key={session.id} className="pref-row" style={{ padding: '10px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="pref-label">
              {describeAgent(session.userAgent)}
              {session.current && ' — this device'}
            </div>
            <div className="pref-hint">
              {session.ip ? `${session.ip} · ` : ''}last seen{' '}
              {new Date(session.lastSeenAt).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
      {others.length > 0 && (
        <button
          className="btn"
          disabled={revoking}
          onClick={async () => {
            setRevoking(true);
            try {
              await api.auth.logoutOthers();
            } catch (err) {
              showError(err);
            } finally {
              setRevoking(false);
            }
          }}
        >
          Sign out everywhere else
        </button>
      )}
    </div>
  );
}

/** "Chrome on macOS", best effort, because a raw user-agent string helps nobody. */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser = userAgent.includes('Firefox/')
    ? 'Firefox'
    : userAgent.includes('Edg/')
      ? 'Edge'
      : userAgent.includes('Chrome/')
        ? 'Chrome'
        : userAgent.includes('Safari/')
          ? 'Safari'
          : 'Browser';
  const os = userAgent.includes('Mac OS X')
    ? 'macOS'
    : userAgent.includes('Windows')
      ? 'Windows'
      : userAgent.includes('Android')
        ? 'Android'
        : /iPhone|iPad/.test(userAgent)
          ? 'iOS'
          : userAgent.includes('Linux')
            ? 'Linux'
            : '';
  return os ? `${browser} on ${os}` : browser;
}
