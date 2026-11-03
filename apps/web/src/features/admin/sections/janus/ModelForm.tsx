/** What Janus answers with: the provider, the model, the address, and the key.
 *
 * Two rules shape this form and neither is cosmetic.
 *
 * **The key is write-only.** The field starts empty, renders no value on any path, and is
 * cleared the moment the save resolves — success or refusal alike, because a refusal is
 * exactly when somebody walks away from the screen. Blob never had the key to show: it
 * passes through the app process to Janus and is gone, and `providers[].key` arrives as
 * `{set, tail?}`. So the field describes rather than prints, and nothing about it is kept
 * anywhere a later render could find it.
 *
 * **Only what changed is sent.** Janus merges a `PUT` into the operator's file key by key;
 * sending the fields nobody touched would write them into a file that had been letting
 * Janus's own defaults stand. A form that always sends everything is how a config file
 * silently grows every default it never asked for.
 *
 * The model is a select when Janus could list the provider's catalogue and a text field
 * when it could not. That is the whole point of the picker: `deepseek-chat` was retired
 * upstream and failed by *hanging*, which is not an error anybody can read — a name the
 * provider itself no longer serves must be unpickable.
 */

import { useId, useState } from "react";
import type { JanusConfigChange } from "../../../../lib/api.ts";
import { Button } from "../../../../components/ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "../../../../components/ui/field.tsx";
import { Input } from "../../../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../../../components/ui/native-select.tsx";
import { Card } from "../../../console/Card.tsx";
import { type JanusSave } from "./apply.ts";
import { Issues } from "./Issues.tsx";
import { withCurrent, type JanusConfig } from "./config.ts";

/** What this form's Save points `aria-describedby` at when Janus has answered. */
const ISSUES_ID = "janus-model-issues";

/** Two fields across where they fit — provider with model, address with key — and one where
 * they do not. The minimum is what a URL and a model name need before they start wrapping
 * mid-token. */
const FIELD_GRID =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-5 gap-y-4";

export function ModelForm({
  config,
  disabled,
  save,
}: {
  config: JanusConfig;
  disabled: boolean;
  save: JanusSave;
}) {
  const [provider, setProvider] = useState(config.model.provider);
  const [model, setModel] = useState(config.model.default);
  const [baseUrl, setBaseUrl] = useState(config.model.base_url);
  // Never seeded, never saved, never read back. The one piece of state on this page that
  // exists only between a keystroke and a request.
  const [key, setKey] = useState("");
  const fields = useId();

  const selected = config.providers.find((entry) => entry.id === provider) ?? null;
  const dead = disabled || save.saving;

  const changed: Record<string, unknown> = {};
  if (provider !== config.model.provider) changed.provider = provider;
  if (model !== config.model.default) changed.default = model;
  if (baseUrl !== config.model.base_url) changed.base_url = baseUrl;
  // A key can be saved for a provider that is not the one in use — that is how a second
  // provider is made ready before switching to it — so it counts as a change on its own.
  // It needs a variable to be saved under, though, and `hasChange` is computed from the
  // same expression the request uses so a key with nowhere to go cannot enable a Save
  // that would then send an empty body.
  const apiKeys = key && selected?.env ? { [selected.env]: key } : null;
  const hasChange = Object.keys(changed).length > 0 || apiKeys !== null;

  async function onSave() {
    const change: JanusConfigChange = {};
    // Never `{}`: Janus answers 400 to an empty `model`, and Blob answers
    // `janus_empty_change` to a body with nothing in it.
    if (Object.keys(changed).length > 0) change.model = changed;
    if (apiKeys) change.apiKeys = apiKeys;
    try {
      await save.run(change);
    } finally {
      setKey("");
    }
  }

  return (
    <Card
      title="Model and provider"
      footer={
        <Button
          disabled={dead || !hasChange}
          aria-describedby={save.issues.length > 0 ? ISSUES_ID : undefined}
          onClick={() => void onSave()}
        >
          Save model
        </Button>
      }
    >
      <div className={FIELD_GRID}>
        <Field>
          <FieldLabel htmlFor={`${fields}-provider`}>Provider</FieldLabel>
          <NativeSelect
            id={`${fields}-provider`}
            className="w-full"
            value={provider}
            disabled={dead}
            onChange={(event) => {
              setProvider(event.target.value);
              // The key goes with it. `apiKeys` is keyed by the *selected* provider's
              // variable, so a key pasted for one provider and left sitting while the
              // select moved to another would be saved under the other's name — and
              // Janus validates the name, never the value, so it would write it.
              setKey("");
            }}
          >
            {withCurrent(
              config.providers.map((entry) => entry.id),
              provider,
            ).map((id) => (
              <NativeSelectOption key={id} value={id} disabled={id === ""}>
                {config.providers.find((entry) => entry.id === id)?.name || id || "—"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${fields}-model`}>Model</FieldLabel>
          {config.models.ids ? (
            <NativeSelect
              id={`${fields}-model`}
              className="w-full"
              aria-describedby={`${fields}-model-hint`}
              value={model}
              disabled={dead}
              onChange={(event) => setModel(event.target.value)}
            >
              {withCurrent(config.models.ids, model).map((id) => (
                <NativeSelectOption key={id} value={id} disabled={id === ""}>
                  {id || "—"}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={`${fields}-model`}
              aria-describedby={`${fields}-model-hint`}
              value={model}
              disabled={dead}
              spellCheck={false}
              onChange={(event) => setModel(event.target.value)}
            />
          )}
          <FieldDescription id={`${fields}-model-hint`}>
            {config.models.ids
              ? "The provider's own list, fetched when this page loaded."
              : config.models.reason
                ? `The provider would not list its models — ${config.models.reason}. Type the name exactly as the provider spells it.`
                : "Type the name exactly as the provider spells it."}
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${fields}-base-url`}>Base URL</FieldLabel>
          <Input
            id={`${fields}-base-url`}
            aria-describedby={`${fields}-base-url-hint`}
            value={baseUrl}
            disabled={dead}
            spellCheck={false}
            placeholder="https://api.deepseek.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <FieldDescription id={`${fields}-base-url-hint`}>
            Only needed for a provider that is not at the address Janus knows it by — a
            proxy, a gateway, or a model served locally.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${fields}-key`}>API key</FieldLabel>
          <Input
            id={`${fields}-key`}
            aria-describedby={`${fields}-key-hint`}
            type="password"
            value={key}
            disabled={dead || !selected?.env}
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste a new key"
            onChange={(event) => setKey(event.target.value)}
          />
          {/* One element, one sentence: the variable and its state are one fact, and a
              key is described here and never printed. Blob does not hold it to print. */}
          <FieldDescription id={`${fields}-key-hint`}>
            {selected
              ? `${selected.env} — ${describeKey(selected.key)}`
              : provider
                ? "Janus lists no key variable for this provider, so there is none to set here."
                : "Pick a provider to set its key."}
          </FieldDescription>
        </Field>
      </div>

      <p className="m-0 max-w-[68ch] text-sm text-pretty text-muted-foreground">
        A key goes straight to Janus and is never stored here, never logged, and never sent
        back to this page. Janus writes it beside its own config, where its{" "}
        <code>config set</code> would put it. Saving an empty box changes nothing.
      </p>

      <Issues id={ISSUES_ID} issues={save.issues} />
    </Card>
  );
}

/** "set, ends a4f2" / "set" / "not set" — every state a key may be described in. */
function describeKey(key: { set: boolean; tail?: string }): string {
  if (!key.set) return "not set";
  // No tail for a key of four characters or fewer: the last four characters of a
  // four-character secret are the secret, so Janus sends nothing and neither do we.
  return key.tail ? `set, ends ${key.tail}` : "set";
}
