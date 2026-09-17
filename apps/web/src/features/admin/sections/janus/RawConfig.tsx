/** `config.yaml` itself, for everything the forms above do not reach.
 *
 * A textarea rather than an editor: a YAML file needs a monospace box and nothing else,
 * and a syntax-highlighting dependency is weight on every page in the bundle for one
 * screen an instance admin opens twice a year.
 *
 * Two things the box has to say out loud, because both are ways to lose something.
 *
 * **The keys shown here are not the keys.** Blob replaces every inline credential in the
 * file with a placeholder on the way out, so what is on the screen cannot be saved back
 * as-is — Blob refuses it rather than writing the placeholder into the file as a
 * password. A save has to put the real key back, or, better, replace it with a `${VAR}`
 * reference, which is left exactly as written because it is a reference and not a secret.
 *
 * **Janus validates the structure, not the meaning.** A provider that exists with a model
 * that does not passes every check here and fails at the first run. The pickers above
 * exist to make that impossible; this box is for people who accept it.
 */

import { useState } from "react";
import { type JanusSave } from "./apply.ts";
import { Issues } from "./Issues.tsx";
import type { JanusConfig } from "./config.ts";

/** What this form's Save points `aria-describedby` at when Janus has answered. */
const ISSUES_ID = "janus-raw-issues";

export function RawConfig({
  config,
  disabled,
  save,
}: {
  config: JanusConfig;
  disabled: boolean;
  save: JanusSave;
}) {
  const [text, setText] = useState(config.raw);
  const dead = disabled || save.saving;

  return (
    <div className="janus-part">
      <h3 className="section-label">Advanced</h3>
      <div className="pref-hint">
        Janus's <code>config.yaml</code>, as it is on disk. Saving replaces the whole file
        and goes on its own — Janus refuses a file sent alongside any of the forms above,
        because a merged edit and a whole-file edit cannot both be the truth. It checks
        that the structure is valid, not that it means anything: a provider that exists
        with a model that does not will save here and fail at the next run.
      </div>

      <label className="field-label" htmlFor="janus-raw">
        config.yaml
      </label>
      <textarea
        id="janus-raw"
        className="input janus-raw"
        value={text}
        disabled={dead}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
      />

      <p className="pref-hint">
        Keys written into this file are shown as <code>«redacted»</code> — Blob never has
        the value to show. A save must put the real key back, or replace it with a{" "}
        <code>${"{VAR}"}</code> reference to the environment, which is left alone. Saving
        the placeholder is refused rather than written.
      </p>

      <Issues id={ISSUES_ID} issues={save.issues} />

      <button
        type="button"
        className="btn btn-primary"
        aria-describedby={save.issues.length > 0 ? ISSUES_ID : undefined}
        disabled={dead || text === config.raw}
        onClick={() => void save.run({ raw: text })}
      >
        Save config.yaml
      </button>
    </div>
  );
}
