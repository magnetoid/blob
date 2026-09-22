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

import { useState } from "react";
import type { JanusConfigChange } from "../../../../lib/api.ts";
import { Card } from "../../../console/Card.tsx";
import { type JanusSave } from "./apply.ts";
import { Issues } from "./Issues.tsx";
import { withCurrent, type JanusConfig } from "./config.ts";

/** What this form's Save points `aria-describedby` at when Janus has answered. */
const ISSUES_ID = "janus-model-issues";

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
      className="janus-part"
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={dead || !hasChange}
          aria-describedby={save.issues.length > 0 ? ISSUES_ID : undefined}
          onClick={() => void onSave()}
        >
          Save model
        </button>
      }
    >
      <div className="janus-form">
        <div className="field">
          <label className="field-label" htmlFor="janus-provider">
            Provider
          </label>
          <select
            id="janus-provider"
            className="input"
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
              <option key={id} value={id} disabled={id === ""}>
                {config.providers.find((entry) => entry.id === id)?.name || id || "—"}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="janus-model">
            Model
          </label>
          {config.models.ids ? (
            <select
              id="janus-model"
              className="input"
              value={model}
              disabled={dead}
              onChange={(event) => setModel(event.target.value)}
            >
              {withCurrent(config.models.ids, model).map((id) => (
                <option key={id} value={id} disabled={id === ""}>
                  {id || "—"}
                </option>
              ))}
            </select>
          ) : (
            <input
              id="janus-model"
              className="input"
              value={model}
              disabled={dead}
              spellCheck={false}
              onChange={(event) => setModel(event.target.value)}
            />
          )}
          <span className="pref-hint">
            {config.models.ids
              ? "The provider's own list, fetched when this page loaded."
              : config.models.reason
                ? `The provider would not list its models — ${config.models.reason}. Type the name exactly as the provider spells it.`
                : "Type the name exactly as the provider spells it."}
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="janus-base-url">
            Base URL
          </label>
          <input
            id="janus-base-url"
            className="input"
            value={baseUrl}
            disabled={dead}
            spellCheck={false}
            placeholder="https://api.deepseek.com/v1"
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <span className="pref-hint">
            Only needed for a provider that is not at the address Janus knows it by — a
            proxy, a gateway, or a model served locally.
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="janus-key">
            API key
          </label>
          <input
            id="janus-key"
            className="input"
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
          <span className="pref-hint">
            {selected
              ? `${selected.env} — ${describeKey(selected.key)}`
              : provider
                ? "Janus lists no key variable for this provider, so there is none to set here."
                : "Pick a provider to set its key."}
          </span>
        </div>
      </div>

      <p className="pref-hint">
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
