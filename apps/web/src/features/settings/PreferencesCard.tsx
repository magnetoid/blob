/** How this account looks and behaves.
 *
 * A private page at /settings. Server settings live under /admin. The two used to share
 * a console named after the workspace, which made a preference look like an admin screen.
 */

import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { deviceZone, knownZones, timeIn } from './timezones.ts';
import { useStore } from '../../lib/store.ts';
import type { Theme } from '@blob/shared';

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

export function PreferencesCard() {
  const currentUser = useStore((s) => s.currentUser);
  const setPrefs = useStore((s) => s.setPrefs);
  const themes = useStore((s) => s.themes);

  const prefs = currentUser?.prefs;
  if (!prefs || !currentUser) return null;

  return (
    <>
      <h2 className="section-label" style={{ marginTop: 0 }}>
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
      <PaletteGallery
        themes={themes.filter((t) => t.mode === 'light')}
        chosen={prefs.themeLight}
        onChoose={(slug) => void setPrefs({ themeLight: slug })}
      />

      <h2 className="section-label" style={{ marginTop: 26 }}>
        Dark palette
      </h2>
      <PaletteGallery
        themes={themes.filter((t) => t.mode === 'dark')}
        chosen={prefs.themeDark}
        onChoose={(slug) => void setPrefs({ themeDark: slug })}
      />

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
        Time zone
      </h2>
      <TimeZoneRow />

      <h2 className="section-label" style={{ marginTop: 26 }}>
        Language and input
      </h2>

      <div className="pref-row">
        <div className="grow">
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
        <div className="grow">
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
        <div className="grow">
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

    </>
  );
}

/**
 * The palettes for one mode, each showing what it actually looks like.
 *
 * A single accent dot beside a name told you almost nothing — two themes with the same
 * accent were indistinguishable until you picked one and looked at the app. A palette is
 * mostly its page, its sidebar and its surfaces, so the tile draws those, in miniature,
 * in the theme's own colours. Slack sells its themes this way for the same reason.
 */
function PaletteGallery({
  themes,
  chosen,
  onChoose,
}: {
  themes: Theme[];
  chosen: string;
  onChoose: (slug: string) => void;
}) {
  if (themes.length === 0) {
    return <p className="pref-hint">This workspace has no palettes for this mode yet.</p>;
  }
  return (
    <div className="palette-gallery">
      {themes.map((theme) => {
        const token = (name: string, fallback: string) => theme.tokens[name] ?? fallback;
        const base = theme.mode === 'dark';
        return (
          <button
            key={theme.id}
            className="palette-tile"
            aria-pressed={chosen === theme.slug}
            onClick={() => onChoose(theme.slug)}
            title={theme.name}
          >
            <span
              className="palette-preview"
              style={{ background: token('--bg', base ? '#141614' : '#fcfcfa') }}
              aria-hidden="true"
            >
              <span
                className="palette-preview-rail"
                style={{ background: token('--bg-sidebar', base ? '#171a17' : '#faf9f6') }}
              />
              <span className="palette-preview-body">
                <span
                  className="palette-preview-line"
                  style={{ background: token('--surface-muted', base ? '#1f221f' : '#f7f6f1') }}
                />
                <span
                  className="palette-preview-line short"
                  style={{ background: token('--surface-muted', base ? '#1f221f' : '#f7f6f1') }}
                />
                <span
                  className="palette-preview-accent"
                  style={{ background: token('--accent', base ? '#5fb287' : '#1f5c3d') }}
                />
              </span>
            </span>
            <span className="palette-name">{theme.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The zone quiet hours and reminders are read in.
 *
 * It had no control at all, so every account kept the `UTC` default and "remind me
 * tomorrow at 9" meant 09:00 UTC — printed back in the same zone, so it read as correct.
 * The clock beside the picker is the part that makes a wrong setting obvious.
 */
function TimeZoneRow() {
  const currentUser = useStore((s) => s.currentUser);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ticks so the sample clock is not frozen at mount. A minute is plenty for a clock
  // that shows hours and minutes.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!currentUser) return null;

  const zone = currentUser.timezone || 'UTC';
  const device = deviceZone();
  const zones = knownZones();
  // Whatever the account holds stays selectable even if this browser has never heard of
  // it — otherwise opening this page on an old browser would silently offer to move you.
  const options = zones.includes(zone) ? zones : [zone, ...zones];
  const clock = timeIn(zone, now);

  async function choose(next: string) {
    if (next === zone || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { user } = await api.me.update({ timezone: next });
      useStore.setState({ currentUser: user });
    } catch {
      setError('That did not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <p className="pref-hint" style={{ marginTop: 8 }}>
        Quiet hours and <code>/remind</code> are read in this zone.
        {clock && ` It is ${clock} there now.`}
      </p>
      <select
        className="input"
        aria-label="Time zone"
        style={{ maxWidth: 320, marginTop: 8 }}
        value={zone}
        disabled={saving}
        onChange={(event) => void choose(event.target.value)}
      >
        {options.map((name) => (
          <option key={name} value={name}>
            {name.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
      {device && device !== zone && (
        <div style={{ marginTop: 8 }}>
          <button className="btn" disabled={saving} onClick={() => void choose(device)}>
            Use this device’s zone ({device.replace(/_/g, ' ')})
          </button>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </>
  );
}

/**
 * Every session this account holds — the standard "was that me?" control. The server
 * has answered `/api/auth/sessions` since the port; this is its first caller.
 */
