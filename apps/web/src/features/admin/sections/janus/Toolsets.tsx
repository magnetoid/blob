/** Which toolsets Janus may use.
 *
 * The one rule here that is not obvious from the screen: a `PUT` of `toolsets` **replaces**
 * the enabled list, so anything left out of it is turned off. A page that sent only the
 * boxes it had drawn would therefore disable, silently, any toolset that is enabled and no
 * longer in `available` — a toolset renamed upstream, or one this build of Janus dropped.
 * So the extras are drawn too, marked, and go back with the rest unless somebody unchecks
 * them on purpose.
 */

import { useState } from "react";
import { type JanusSave } from "./apply.ts";
import { Issues } from "./Issues.tsx";
import type { JanusConfig } from "./config.ts";

/** What this form's Save points `aria-describedby` at when Janus has answered. */
const ISSUES_ID = "janus-toolsets-issues";

export function Toolsets({
  config,
  disabled,
  save,
}: {
  config: JanusConfig;
  disabled: boolean;
  save: JanusSave;
}) {
  const { available, enabled: saved, error } = config.toolsets;
  const [enabled, setEnabled] = useState(saved);

  const dead = disabled || save.saving;
  // Order is Janus's, and a click never reorders: `enabled` keeps the order Janus sent and
  // appends. That is what makes the request body a stable thing to read in a log.
  const rows = [...available, ...enabled.filter((name) => !available.includes(name))];
  const changed =
    enabled.length !== saved.length || enabled.some((name) => !saved.includes(name));

  function toggle(name: string) {
    setEnabled((current) =>
      current.includes(name) ? current.filter((entry) => entry !== name) : [...current, name],
    );
  }

  return (
    <div className="janus-part">
      <h3 className="section-label">Toolsets</h3>
      <div className="pref-hint">
        What Janus can reach during a run, for every workspace on this server. One that
        needs a key of its own and has not been given one comes back as a warning here
        when you save.
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="admin-check-grid">
        {rows.map((name) => {
          const gone = !available.includes(name);
          return (
            <label className="admin-check-card" key={name}>
              <input
                type="checkbox"
                aria-label={name}
                checked={enabled.includes(name)}
                disabled={dead}
                onChange={() => toggle(name)}
              />
              <span>
                <strong>{name}</strong>
                {gone && <small>Enabled, and not offered by this Janus.</small>}
              </span>
            </label>
          );
        })}
      </div>

      {rows.length === 0 && (
        <p className="muted">Janus listed no toolsets.</p>
      )}

      <Issues id={ISSUES_ID} issues={save.issues} />

      <button
        type="button"
        className="btn btn-primary"
        aria-describedby={save.issues.length > 0 ? ISSUES_ID : undefined}
        disabled={dead || !changed}
        // The whole list, always: Janus drops what a `PUT` leaves out.
        onClick={() => void save.run({ toolsets: enabled })}
      >
        Save toolsets
      </button>
    </div>
  );
}
