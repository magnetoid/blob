/** What each workspace may do to this machine.
 *
 * Every app endpoint authorises a *workspace* admin, which was the whole story while one
 * workspace was the server. Multi-workspace split the workspace admin from the person who
 * owns the hardware and left every capability with the former. This is where the operator
 * gets a say.
 *
 * Capability limits rather than a catalogue of approved apps, and that is a deliberate
 * choice: an external app is a URL and its slug is chosen by whoever registers it, so
 * allowlisting *names* controls nothing. What actually differs in risk is what an app can
 * do to the box — run code on it, reach its private network — and those are the switches.
 */

import { useCallback, useState } from "react";
import {
  api,
  type WorkspacePolicy,
  type InstanceWorkspace,
} from "../../../lib/api.ts";
import { useAdminAction, useAdminData } from "../hooks.ts";

interface Capability {
  key: "mayHostAgents" | "mayUsePrivateEndpoints" | "mayConnectSocketAgents";
  label: string;
  hint: string;
  /** Which server-wide flag caps this one, when there is one. */
  ceiling?: "serverAllowsHosting" | "serverAllowsPrivateEndpoints";
  ceilingHint?: string;
}

const CAPABILITIES: Capability[] = [
  {
    key: "mayHostAgents",
    label: "Deploy agents from a repository",
    hint: "The repository's code runs as a container on this machine. The sharpest thing on this page.",
    ceiling: "serverAllowsHosting",
    ceilingHint:
      "Hosting is off for the whole server — set AGENT_RUNNER to turn it on.",
  },
  {
    key: "mayUsePrivateEndpoints",
    label: "Register an app on a private address",
    hint: "Relaxes the guard that stops an app URL pointing at this network — a database, a metadata endpoint.",
    ceiling: "serverAllowsPrivateEndpoints",
    ceilingHint:
      "Private endpoints are off for the whole server — set AGENT_ALLOW_PRIVATE_ENDPOINTS to turn it on.",
  },
  {
    key: "mayConnectSocketAgents",
    label: "Connect agents over a socket",
    hint: "An agent on somebody’s laptop dials in and holds a connection. It reaches nothing it was not granted.",
  },
];

export function AppPolicySection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  const loadWorkspaces = useCallback(() => api.admin.instanceWorkspaces(), []);
  const { data } = useAdminData(
    loadWorkspaces,
    [],
    onError,
    "Could not load workspaces.",
  );
  const workspaces = data?.workspaces ?? [];

  // Defaults to the first workspace so the page is never an empty frame.
  const workspaceId = selected ?? workspaces[0]?.id ?? null;

  return (
    <section style={{ maxWidth: 640 }}>
      <label className="field" style={{ maxWidth: 320 }}>
        <span className="field-label">Workspace</span>
        <select
          className="input"
          value={workspaceId ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {workspaces.map((workspace: InstanceWorkspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>

      {workspaceId && (
        <PolicyEditor workspaceId={workspaceId} onError={onError} />
      )}
    </section>
  );
}

function PolicyEditor({
  workspaceId,
  onError,
}: {
  workspaceId: string;
  onError: (message: string | null) => void;
}) {
  const load = useCallback(
    () => api.admin.workspacePolicy(workspaceId),
    [workspaceId],
  );
  const { data: policy, reload } = useAdminData(
    load,
    [workspaceId],
    onError,
    "Could not load this policy.",
  );
  const act = useAdminAction(onError, reload);

  if (!policy) return null;

  function save(patch: Partial<WorkspacePolicy>) {
    void act(async () => {
      await api.admin.setWorkspacePolicy(workspaceId, patch);
    });
  }

  return (
    <>
      <h2 className="section-label" style={{ marginTop: 26 }}>
        What this workspace may do
      </h2>

      {CAPABILITIES.map((capability) => {
        // A switch that cannot take effect is shown off and disabled, with the reason.
        // Rendering it enabled would be a lie the guards then quietly contradict.
        const cappedOff = capability.ceiling
          ? !policy[capability.ceiling]
          : false;
        return (
          <div className="pref-row" key={capability.key}>
            <div style={{ flex: 1 }}>
              <div className="pref-label">{capability.label}</div>
              <div className="pref-hint">
                {cappedOff ? capability.ceilingHint : capability.hint}
              </div>
            </div>
            <button
              className="toggle"
              aria-pressed={policy[capability.key] && !cappedOff}
              aria-label={capability.label}
              disabled={cappedOff}
              onClick={() =>
                save({ [capability.key]: !policy[capability.key] })
              }
            >
              <span />
            </button>
          </div>
        );
      })}

      <div className="pref-row">
        <div style={{ flex: 1 }}>
          <div className="pref-label">Most apps it may install</div>
          <div className="pref-hint">
            Leave empty for no limit. Reaching it stops the next install; it
            never stops editing an app that is already there.
          </div>
        </div>
        <input
          className="input"
          type="number"
          min={0}
          max={1000}
          aria-label="Most apps it may install"
          style={{ maxWidth: 110 }}
          defaultValue={policy.maxApps ?? ""}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            const next = raw === "" ? null : Number(raw);
            if (next === policy.maxApps) return;
            if (next !== null && !Number.isFinite(next)) return;
            save({ maxApps: next });
          }}
        />
      </div>

      <p className="pref-hint" style={{ marginTop: 18 }}>
        A workspace admin cannot read or change any of this. Blocking a scope
        here stops it being granted to any app in that workspace, whatever its
        admins approve.
      </p>
    </>
  );
}
