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
import { Card } from '../console/Card.tsx';

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
  const translationEnabled = useStore((s) => s.translationEnabled);
  const setPrefs = useStore((s) => s.setPrefs);
  const themes = useStore((s) => s.themes);

  const prefs = currentUser?.prefs;
  if (!prefs || !currentUser) return null;

  // Two cards, for the two groups this part always had: how Blob looks (with the zone
  // it reads the clock in), and language and input. What were overlines are the rows'
  // own labels now, still headings for a screen reader to move by.
  return (
    <>
    <Card
      title="Preferences"
      description="How Blob looks and behaves, on this device and everywhere."
    >
      <div className="pref-row">
        <div className="grow">
          <h3 className="pref-label">Theme</h3>
        </div>
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
      </div>

      <div className="pref-block">
        <h3 className="pref-label">Light palette</h3>
        <PaletteGallery
          themes={themes.filter((theme) => theme.mode === 'light' && theme.isEnabled)}
          chosen={prefs.themeLight}
          onChoose={(slug) => void setPrefs({ themeLight: slug })}
        />
      </div>

      <div className="pref-block">
        <h3 className="pref-label">Dark palette</h3>
        <PaletteGallery
          themes={themes.filter((theme) => theme.mode === 'dark' && theme.isEnabled)}
          chosen={prefs.themeDark}
          onChoose={(slug) => void setPrefs({ themeDark: slug })}
        />
      </div>

      <div className="pref-row">
        <div className="grow">
          <h3 className="pref-label">Density</h3>
        </div>
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
      </div>

      <TimeZoneRow />
    </Card>

    <Card title="Language and input">
      {/* Both rows only mean something on a server that can translate. Elsewhere one
          line says why there is nothing to set, rather than a select and a switch whose
          only possible outcome is "not configured". */}
      {translationEnabled ? (
        <>
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
        </>
      ) : (
        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Translation</div>
            <div className="pref-hint">
              Not configured on this server (TRANSLATION_PROVIDER), so there is nothing to
              choose here yet.
            </div>
          </div>
        </div>
      )}

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
    </Card>
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
    return <p className="pref-hint console-note">This workspace has no palettes for this mode yet.</p>;
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

  // A row of the Preferences card: what the zone is for on the left, the picker — and the
  // offer of this device's zone when it differs — on the right.
  return (
    <div className="pref-row">
      <div className="grow">
        <h3 className="pref-label">Time zone</h3>
        <div className="pref-hint">
          Quiet hours and <code>/remind</code> are read in this zone.
          {clock && ` It is ${clock} there now.`}
        </div>
        {error && <p className="error-text console-note">{error}</p>}
      </div>
      <div className="console-row-controls">
        <select
          className="input"
          aria-label="Time zone"
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
          <button className="btn" disabled={saving} onClick={() => void choose(device)}>
            Use this device’s zone ({device.replace(/_/g, ' ')})
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Every session this account holds — the standard "was that me?" control. The server
 * has answered `/api/auth/sessions` since the port; this is its first caller.
 */
