/** How this account looks and behaves.
 *
 * A private page at /settings. Server settings live under /admin. The two used to share
 * a console named after the workspace, which made a preference look like an admin screen.
 */

import { useEffect, useId, useState, type CSSProperties } from 'react';
import { Radio } from '@base-ui/react/radio';
import { api } from '../../lib/api.ts';
import { deviceZone, knownZones, timeIn } from './timezones.ts';
import { useStore } from '../../lib/store.ts';
import { B0_HEX } from '../../lib/theme.ts';
import type { Theme } from '@blob/shared';
import { Button } from '../../components/ui/button.tsx';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '../../components/ui/field.tsx';
import { NativeSelect, NativeSelectOption } from '../../components/ui/native-select.tsx';
import { RadioGroup } from '../../components/ui/radio-group.tsx';
import { Switch } from '../../components/ui/switch.tsx';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group.tsx';
import { Card, CardFields, CardHeading } from '../console/Card.tsx';

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

/** A row's own heading: the setting's name, still a heading for a screen reader to move by. */
const ROW_HEADING = 'text-sm leading-snug font-medium';

export function PreferencesCard() {
  const currentUser = useStore((s) => s.currentUser);
  const translationEnabled = useStore((s) => s.translationEnabled);
  const setPrefs = useStore((s) => s.setPrefs);
  const themes = useStore((s) => s.themes);
  const hint = useId();

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
        <CardFields>
          <Field orientation="horizontal">
            <FieldContent>
              <CardHeading className={ROW_HEADING}>Theme</CardHeading>
            </FieldContent>
            <ToggleGroup
              aria-label="Theme"
              variant="outline"
              spacing={0}
              value={[prefs.theme]}
              // Pressing the one that is chosen would leave nothing chosen, which is not a theme.
              onValueChange={([next]) => {
                const theme = THEMES.find((t) => t.value === next);
                if (theme) void setPrefs({ theme: theme.value });
              }}
            >
              {THEMES.map((theme) => (
                <ToggleGroupItem key={theme.value} value={theme.value}>
                  {theme.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <Field>
            <CardHeading className={ROW_HEADING}>Light palette</CardHeading>
            <PaletteGallery
              label="Light palette"
              themes={themes.filter((theme) => theme.mode === 'light' && theme.isEnabled)}
              chosen={prefs.themeLight}
              onChoose={(slug) => void setPrefs({ themeLight: slug })}
            />
          </Field>

          <Field>
            <CardHeading className={ROW_HEADING}>Dark palette</CardHeading>
            <PaletteGallery
              label="Dark palette"
              themes={themes.filter((theme) => theme.mode === 'dark' && theme.isEnabled)}
              chosen={prefs.themeDark}
              onChoose={(slug) => void setPrefs({ themeDark: slug })}
            />
          </Field>

          <Field orientation="horizontal">
            <FieldContent>
              <CardHeading className={ROW_HEADING}>Density</CardHeading>
            </FieldContent>
            <ToggleGroup
              aria-label="Density"
              variant="outline"
              spacing={0}
              value={[prefs.density]}
              onValueChange={([next]) => {
                const density = DENSITIES.find((d) => d.value === next);
                if (density) void setPrefs({ density: density.value });
              }}
            >
              {DENSITIES.map((density) => (
                <ToggleGroupItem key={density.value} value={density.value}>
                  {density.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>

          <TimeZoneRow />
        </CardFields>
      </Card>

      <Card title="Language and input">
        <CardFields>
          {/* Both rows only mean something on a server that can translate. Elsewhere one
              line says why there is nothing to set, rather than a select and a switch whose
              only possible outcome is "not configured". */}
          {translationEnabled ? (
            <>
              <Field orientation="responsive">
                <FieldContent>
                  <FieldLabel htmlFor="preferred-language">Preferred language</FieldLabel>
                  <FieldDescription id={`${hint}-language`}>
                    Message translation uses this as your target language when teammates write in
                    another language.
                  </FieldDescription>
                </FieldContent>
                <NativeSelect
                  id="preferred-language"
                  aria-describedby={`${hint}-language`}
                  value={prefs.language ?? ''}
                  onChange={(event) =>
                    void setPrefs({
                      language: event.target.value || null,
                      autoTranslate: !!event.target.value && prefs.autoTranslate,
                    })
                  }
                >
                  {LANGUAGES.map((language) => (
                    <NativeSelectOption key={language.value || 'system'} value={language.value}>
                      {language.label}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>

              <Field orientation="horizontal" data-disabled={!prefs.language || undefined}>
                <FieldContent>
                  <FieldLabel htmlFor="auto-translate">Auto-translate incoming messages</FieldLabel>
                  <FieldDescription id={`${hint}-auto-translate`}>
                    Show translated copies inline when your preferred language is set.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="auto-translate"
                  aria-describedby={`${hint}-auto-translate`}
                  checked={prefs.autoTranslate && !!prefs.language}
                  onCheckedChange={(on) =>
                    void setPrefs({ autoTranslate: !!prefs.language && on })
                  }
                  disabled={!prefs.language}
                  title={prefs.language ? undefined : 'Choose a preferred language first.'}
                />
              </Field>
            </>
          ) : (
            <Field>
              <FieldContent>
                <FieldTitle>Translation</FieldTitle>
                <FieldDescription>
                  Not configured on this server (TRANSLATION_PROVIDER), so there is nothing to
                  choose here yet.
                </FieldDescription>
              </FieldContent>
            </Field>
          )}

          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="enter-sends">Enter sends a message</FieldLabel>
              <FieldDescription id={`${hint}-enter`}>
                When off, Enter starts a new line and ⌘Enter sends instead.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="enter-sends"
              aria-describedby={`${hint}-enter`}
              checked={prefs.enterToSend}
              onCheckedChange={(on) => void setPrefs({ enterToSend: on })}
            />
          </Field>
        </CardFields>
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
 *
 * A choice of one, so a radio group: the tiles are one stop for the Tab key and the arrow
 * keys move between them, choosing as they go.
 */
function PaletteGallery({
  label,
  themes,
  chosen,
  onChoose,
}: {
  label: string;
  themes: Theme[];
  chosen: string;
  onChoose: (slug: string) => void;
}) {
  if (themes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This workspace has no palettes for this mode yet.
      </p>
    );
  }
  return (
    <RadioGroup
      aria-label={label}
      value={chosen}
      onValueChange={(slug) => onChoose(String(slug))}
      className="grid-cols-[repeat(auto-fill,minmax(116px,1fr))] gap-2.5"
    >
      {themes.map((theme) => (
        <PaletteTile key={theme.id} theme={theme} />
      ))}
    </RadioGroup>
  );
}

function PaletteTile({ theme }: { theme: Theme }) {
  // What the theme sets, else shadcn b0's — the palette it is drawn over.
  const fallback = B0_HEX[theme.mode];
  const token = (name: keyof typeof fallback) => theme.tokens[name] ?? fallback[name];
  // The four colours are the theme's own — data, not paint this file chose — so they ride
  // on the tile as custom properties, and the swatch's parts read them by name.
  const colours = {
    '--swatch-page': token('--background'),
    '--swatch-rail': token('--sidebar'),
    '--swatch-line': token('--muted'),
    '--swatch-primary': token('--primary'),
  } as CSSProperties;

  return (
    <Radio.Root
      value={theme.slug}
      style={colours}
      className="group/tile flex cursor-pointer flex-col gap-1.5 rounded-lg p-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-primary/10 data-checked:text-foreground"
    >
      {/* A ring rather than a border: a preview of a pale theme on a pale page needs an edge,
          and the ring does not eat a pixel of the palette it is showing. */}
      <span
        aria-hidden="true"
        className="flex h-15.5 overflow-hidden rounded-md bg-(--swatch-page) ring-1 ring-foreground/15 group-data-checked/tile:ring-2 group-data-checked/tile:ring-primary"
      >
        <span className="w-[30%] flex-none bg-(--swatch-rail)" />
        <span className="flex flex-1 flex-col justify-center gap-[5px] px-2">
          <span className="h-[5px] rounded-full bg-(--swatch-line)" />
          <span className="h-[5px] w-[62%] rounded-full bg-(--swatch-line)" />
          <span className="mt-0.5 h-2 w-[34%] rounded-full bg-(--swatch-primary)" />
        </span>
      </span>
      <span className="pl-0.5 font-medium">{theme.name}</span>
    </Radio.Root>
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
  const hint = useId();
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
    <Field orientation="responsive">
      <FieldContent>
        <CardHeading className={ROW_HEADING}>Time zone</CardHeading>
        <FieldDescription id={hint}>
          Quiet hours and <code className="font-mono text-xs">/remind</code> are read in this
          zone.
          {clock && ` It is ${clock} there now.`}
        </FieldDescription>
        {error && <FieldError>{error}</FieldError>}
      </FieldContent>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label="Time zone"
          aria-describedby={hint}
          value={zone}
          disabled={saving}
          onChange={(event) => void choose(event.target.value)}
        >
          {options.map((name) => (
            <NativeSelectOption key={name} value={name}>
              {name.replace(/_/g, ' ')}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {device && device !== zone && (
          <Button variant="outline" disabled={saving} onClick={() => void choose(device)}>
            Use this device’s zone ({device.replace(/_/g, ' ')})
          </Button>
        )}
      </div>
    </Field>
  );
}

/**
 * Every session this account holds — the standard "was that me?" control. The server
 * has answered `/api/auth/sessions` since the port; this is its first caller.
 */
