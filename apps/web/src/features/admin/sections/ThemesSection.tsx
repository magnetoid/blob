/**
 * The theme editor.
 *
 * Edits are previewed on the live UI rather than in a mock frame — the fastest way to
 * see whether a palette actually works is to look at the app wearing it. Nothing is
 * saved until you press Save, and Cancel puts the previous palette back.
 */

import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import type { Theme } from "@blob/shared";
import { api, ApiError } from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { useStore } from "../../../lib/store.ts";
import { toHex } from "../../../lib/color.ts";
import {
  applyTheme,
  B0_HEX,
  pickTheme,
  previewTheme,
  themeChoices,
} from "../../../lib/theme.ts";
import { themeContrastIssues } from "../../../lib/themeContrast.ts";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert.tsx";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Field, FieldLabel } from "../../../components/ui/field.tsx";
import { Input } from "../../../components/ui/input.tsx";
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../../../components/ui/item.tsx";
import { Label } from "../../../components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import { Card, CardRow, CardRows } from "../../console/Card.tsx";

/**
 * The platform's colour input has no shadcn part, so it is drawn to sit with the other
 * controls: a bordered square that is the swatch itself, with the browser's own frame
 * round the colour taken off (`-webkit-` is Chrome and Safari, `-moz-` is Firefox).
 * Touch gets the same 44px as every other control.
 */
const COLOUR_INPUT = [
  "size-8 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5 outline-none",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-11",
  "[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-0",
  "[&::-moz-color-swatch]:rounded-sm [&::-moz-color-swatch]:border-0",
].join(" ");

/**
 * The colour a theme is known by. It is the theme's own data, so it rides in as a custom
 * property for the class to read — `bg-(--swatch)` — and the node carries nothing else:
 * the look is the class's, and the colour is the only thing the row has to say.
 */
function Swatch({ color }: { color: string }) {
  const vars = { "--swatch": color } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      style={vars}
      className="size-7 shrink-0 rounded-md bg-(--swatch) inset-ring-1 inset-ring-foreground/15"
    />
  );
}

export function ThemesSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const themes = useStore((s) => s.themes);
  const prefs = useStore((s) => s.currentUser?.prefs);

  const [groups, setGroups] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<Theme | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"light" | "dark">("light");
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [baseTokens, setBaseTokens] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Theme | null>(null);
  const fields = useId();

  useEffect(() => {
    void api.themes
      .list()
      .then((r) => {
        setGroups(r.groups);
        useStore.setState({ themes: r.themes });
      })
      .catch(() => onError("Could not load themes."));
  }, [onError]);

  /** Put the user's own palette back after a preview. */
  const restore = useCallback(() => {
    if (prefs) {
      const available = useStore.getState().themes;
      applyTheme(
        pickTheme(available, prefs),
        prefs.theme,
        themeChoices(available, prefs),
      );
    }
  }, [prefs]);

  function previewEditor(
    nextMode: "light" | "dark",
    nextTokens: Record<string, string>,
    refreshBase = false,
  ) {
    if (refreshBase) {
      previewTheme({ mode: nextMode, tokens: {} });
      const computed = getComputedStyle(document.documentElement);
      setBaseTokens(
        Object.fromEntries(
          Object.values(groups)
            .flat()
            .map((token) => [
              token,
              // `<input type="color">` only takes #rrggbb; shadcn's own values are oklch().
              toHex(computed.getPropertyValue(token)) ?? "#000000",
            ]),
        ),
      );
    }
    previewTheme({ mode: nextMode, tokens: nextTokens });
  }

  function startEdit(theme: Theme, duplicate: boolean) {
    setEditing(duplicate ? { ...theme, id: "", isPreset: false } : theme);
    setName(duplicate ? `${theme.name} copy` : theme.name);
    setMode(theme.mode);
    setTokens({ ...theme.tokens });
    previewEditor(theme.mode, theme.tokens, true);
  }

  function stopEdit() {
    setEditing(null);
    setTokens({});
    restore();
  }

  function setToken(token: string, value: string) {
    const next = { ...tokens, [token]: value };
    setTokens(next);
    previewEditor(mode, next);
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
      onError(
        err instanceof ApiError ? err.message : "Could not save that theme.",
      );
    } finally {
      setSaving(false);
    }
  }

  const editableGroups = useMemo(() => Object.entries(groups), [groups]);
  const contrastIssues = useMemo(
    () => themeContrastIssues({ ...baseTokens, ...tokens }),
    [baseTokens, tokens],
  );

  if (editing) {
    return (
      <div className="flex flex-col gap-6">
        <Card
          description={
            <>
              Changes preview on this window as you make them. Nothing is stored
              until you save. Colours you leave alone keep the built-in value.
            </>
          }
          footer={
            <>
              <Button variant="outline" onClick={stopEdit}>
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving || contrastIssues.length > 0}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={`${fields}-name`}>Theme name</FieldLabel>
              <Input
                id={`${fields}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${fields}-mode`}>Mode</FieldLabel>
              <NativeSelect
                id={`${fields}-mode`}
                value={mode}
                onChange={(e) => {
                  const next = e.target.value as "light" | "dark";
                  setMode(next);
                  previewEditor(next, tokens, true);
                }}
              >
                <NativeSelectOption value="light">light</NativeSelectOption>
                <NativeSelectOption value="dark">dark</NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
          {contrastIssues.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>
                Contrast needs attention before this theme can be saved.
              </AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {contrastIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </Card>

        {editableGroups.map(([group, groupTokens]) => (
          <Card key={group} title={group}>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {groupTokens.map((token) => {
                const inputId = `theme-${token.slice(2)}`;
                // Without its dashes: the words beside the swatch, and the field's name.
                const shown = token.replace(/^--/, "");
                return (
                  <div className="flex items-center gap-2" key={token}>
                    <input
                      id={inputId}
                      type="color"
                      className={COLOUR_INPUT}
                      value={
                        toHex(tokens[token] ?? "") ??
                        baseTokens[token] ??
                        "#000000"
                      }
                      onChange={(e) => setToken(token, e.target.value)}
                    />
                    <Label
                      htmlFor={inputId}
                      className="min-w-0 flex-1 font-mono text-xs font-normal wrap-anywhere"
                    >
                      {shown}
                    </Label>
                    {tokens[token] && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        title="Reset to the built-in value"
                        aria-label={`Reset ${shown} to the built-in value`}
                        onClick={() => {
                          const next = { ...tokens };
                          delete next[token];
                          setTokens(next);
                          previewEditor(mode, next);
                        }}
                      >
                        <span aria-hidden="true">↺</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="Themes"
        description="Presets ship with the app and cannot be edited — duplicate one to start from it. People choose their own light and dark palettes in Preferences."
      >
        <CardRows>
          {themes.map((theme) => (
            <CardRow key={theme.id}>
              <ItemMedia>
                <Swatch
                  color={theme.tokens["--primary"] ?? B0_HEX[theme.mode]["--primary"]}
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {theme.name}
                  <Badge variant="outline">{theme.mode}</Badge>
                  {theme.isPreset && <Badge variant="secondary">preset</Badge>}
                </ItemTitle>
                <ItemDescription>
                  {Object.keys(theme.tokens).length === 0
                    ? "The built-in palette, unchanged"
                    : `${Object.keys(theme.tokens).length} tokens overridden`}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button
                  variant="ghost"
                  aria-label={`Duplicate ${theme.name}`}
                  onClick={() => startEdit(theme, true)}
                >
                  Duplicate
                </Button>
                {!theme.isPreset && (
                  <>
                    <Button
                      variant="outline"
                      aria-label={`Edit ${theme.name}`}
                      onClick={() => startEdit(theme, false)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      aria-label={`Delete ${theme.name}`}
                      onClick={() => setDeleting(theme)}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </ItemActions>
            </CardRow>
          ))}
        </CardRows>
      </Card>

      <DialogPresence when={deleting}>
        {(deleting) => (
          <ConfirmDialog
            title={`Delete “${deleting.name}”?`}
            body="Anyone using it falls back to the workspace default."
            confirmLabel="Delete"
            danger
            onClose={() => setDeleting(null)}
            onConfirm={() => {
              const theme = deleting;
              setDeleting(null);
              void (async () => {
                try {
                  await api.themes.remove(theme.id);
                  const listed = await api.themes.list();
                  useStore.setState({ themes: listed.themes });
                } catch (err) {
                  onError(
                    err instanceof ApiError
                      ? err.message
                      : "Could not delete it.",
                  );
                }
              })();
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}
