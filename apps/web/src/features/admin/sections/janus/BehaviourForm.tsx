/** How hard Janus thinks, how long it may go on, and in what voice.
 *
 * The same rule as the model form: only the fields that changed are sent, because Janus
 * merges a `PUT` into the operator's own file key by key, and a form that sent everything
 * would write Janus's defaults into a file that had been letting them stand.
 *
 * Numbers are sent as numbers. An input's value is a string, always, and Janus answers 400
 * to `max_turns: "80"` — which is a refusal that reads like the page is broken.
 */

import { useState } from "react";
import type { JanusConfigChange } from "../../../../lib/api.ts";
import { Card } from "../../../console/Card.tsx";
import { type JanusSave } from "./apply.ts";
import { Issues } from "./Issues.tsx";
import { withCurrent, type JanusConfig } from "./config.ts";

/** What this form's Save points `aria-describedby` at when Janus has answered. */
const ISSUES_ID = "janus-behaviour-issues";

/**
 * The scale, for a config body that does not enumerate it.
 *
 * Janus's `/v1/config` lists the personalities it knows and not the efforts, so this is
 * the only list on the page that is not Janus's own. It is copied from
 * `janus_constants.VALID_REASONING_EFFORTS` — `("minimal", "low", "medium", "high",
 * "xhigh")` — with `"none"` ahead of it, which `parse_reasoning_effort` takes as
 * reasoning switched off. In that order, because it is an ordered scale and a select is
 * read as one.
 *
 * `withCurrent` is what keeps the copy honest: whatever Janus is actually running on
 * stays selectable, so a release that adds a seventh step degrades to "the new one is in
 * the list and the other six are too" rather than to a select that reads back as `none`.
 */
const EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh"];

export function BehaviourForm({
  config,
  disabled,
  save,
}: {
  config: JanusConfig;
  disabled: boolean;
  save: JanusSave;
}) {
  const saved = config.agent;
  const [effort, setEffort] = useState(saved.reasoning_effort);
  const [maxTurns, setMaxTurns] = useState(text(saved.max_turns));
  // Not `timeout`/`setTimeout`: that pair shadows the global of the same name.
  const [idle, setIdle] = useState(text(saved.gateway_timeout));
  const [personality, setPersonality] = useState(saved.personality);

  const dead = disabled || save.saving;

  const changed: Record<string, unknown> = {};
  if (effort !== saved.reasoning_effort) changed.reasoning_effort = effort;
  if (personality !== saved.personality) changed.personality = personality;
  // A box emptied or filled with something that is not a number is not a change: there is
  // no value to send, and sending `null` would clear a setting nobody asked to clear.
  const turns = number(maxTurns);
  if (turns !== null && turns !== saved.max_turns) changed.max_turns = turns;
  const seconds = number(idle);
  if (seconds !== null && seconds !== saved.gateway_timeout) changed.gateway_timeout = seconds;

  const change: JanusConfigChange =
    Object.keys(changed).length > 0 ? { agent: changed } : {};

  return (
    <Card
      title="Behaviour"
      className="janus-part"
      footer={
        <button
          type="button"
          className="btn btn-primary"
          disabled={dead || !change.agent}
          aria-describedby={save.issues.length > 0 ? ISSUES_ID : undefined}
          onClick={() => void save.run(change)}
        >
          Save behaviour
        </button>
      }
    >
      <div className="janus-form">
        <div className="field">
          <label className="field-label" htmlFor="janus-effort">
            Reasoning effort
          </label>
          <select
            id="janus-effort"
            className="input"
            value={effort}
            disabled={dead}
            onChange={(event) => setEffort(event.target.value)}
          >
            {withCurrent(EFFORTS, effort).map((name) => (
              <option key={name} value={name} disabled={name === ""}>
                {name || "—"}
              </option>
            ))}
          </select>
          <span className="pref-hint">
            How much of a turn goes into thinking before answering. Higher is slower and
            costs more.
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="janus-max-turns">
            Max turns
          </label>
          <input
            id="janus-max-turns"
            className="input"
            type="number"
            min={1}
            value={maxTurns}
            disabled={dead}
            onChange={(event) => setMaxTurns(event.target.value)}
          />
          <span className="pref-hint">
            How many times it may call a tool and think again within one run before it has
            to answer with what it has.
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="janus-timeout">
            Inactivity timeout
          </label>
          <input
            id="janus-timeout"
            className="input"
            type="number"
            min={0}
            value={idle}
            disabled={dead}
            onChange={(event) => setIdle(event.target.value)}
          />
          <span className="pref-hint">
            Seconds a run may go quiet before Janus gives up on it — not how long it may
            take, so a run calling tools for an hour is never cut off. 0 is no limit at
            all. Janus calls this <code>agent.gateway_timeout</code>. A run Blob starts
            from a mention is bounded by Blob's own limits as well —{" "}
            <code>AGUI_READ_TIMEOUT_SEC</code> between events and{" "}
            <code>AGUI_MAX_RUN_SEC</code> over the whole run — and whichever runs out
            first cuts the stream, so this is the ceiling for Janus's other callers rather
            than the floor for a mention.
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="janus-personality">
            Personality
          </label>
          <select
            id="janus-personality"
            className="input"
            value={personality}
            disabled={dead}
            onChange={(event) => setPersonality(event.target.value)}
          >
            {withCurrent(config.personalities, personality).map((name) => (
              <option key={name} value={name} disabled={name === ""}>
                {name || "—"}
              </option>
            ))}
          </select>
          <span className="pref-hint">
            Janus's own, and the server's for every workspace. What one workspace wants
            said differently belongs in its instructions above.
          </span>
        </div>
      </div>

      <Issues id={ISSUES_ID} issues={save.issues} />
    </Card>
  );
}

/** A number Janus did not send shows as an empty box, not as a zero. */
function text(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * A whole number, or null for "there is nothing here to send".
 *
 * Janus's own rule, matched exactly: `max_turns` and `gateway_timeout` are its
 * `_INT_KEYS`, and it answers 400 to anything that `isinstance(value, bool) or not
 * isinstance(value, int) or value < 0`. So `1.5` is not a value this page may send — it
 * round-trips to a refusal the admin cannot act on — and `0` is, because for
 * `gateway_timeout` it is the documented way to say "no limit".
 */
function number(value: string): number | null {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}
