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

import { useCallback, useId, useState } from "react";
import {
  api,
  type WorkspacePolicy,
  type InstanceWorkspace,
} from "../../../lib/api.ts";
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../../components/ui/field.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import { Switch } from "../../../components/ui/switch.tsx";
import { Card, CardFields } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

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
  const pickerId = useId();

  return (
    <div className="flex flex-col gap-6">
      <Card
        title="What this workspace may do"
        footer={
          <p className="m-0 text-sm text-pretty text-muted-foreground">
            A workspace admin cannot read or change any of this. Blocking a scope
            here stops it being granted to any app in that workspace, whatever its
            admins approve.
          </p>
        }
      >
        <CardFields>
          <Field orientation="responsive">
            <FieldLabel htmlFor={pickerId}>Workspace</FieldLabel>
            <NativeSelect
              id={pickerId}
              value={workspaceId ?? ""}
              onChange={(event) => setSelected(event.target.value)}
            >
              {workspaces.map((workspace: InstanceWorkspace) => (
                <NativeSelectOption key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          {/* Keyed by the workspace: the numbers below are uncontrolled, and what one
              workspace's page holds is not the next one's. */}
          {workspaceId && (
            <PolicyEditor key={workspaceId} workspaceId={workspaceId} onError={onError} />
          )}
        </CardFields>
      </Card>
    </div>
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
  const ids = useId();

  if (!policy) return null;

  function save(patch: Partial<WorkspacePolicy>) {
    void act(async () => {
      await api.admin.setWorkspacePolicy(workspaceId, patch);
    });
  }

  // Rows of the card AppPolicySection draws, under the workspace they apply to.
  return (
    <>
      {CAPABILITIES.map((capability) => {
        // A switch that cannot take effect is shown off and disabled, with the reason.
        // Rendering it enabled would be a lie the guards then quietly contradict.
        const cappedOff = capability.ceiling
          ? !policy[capability.ceiling]
          : false;
        const id = `${ids}-${capability.key}`;
        return (
          <Field orientation="horizontal" key={capability.key}>
            <FieldContent>
              <FieldLabel htmlFor={id}>{capability.label}</FieldLabel>
              <FieldDescription id={`${id}-hint`}>
                {cappedOff ? capability.ceilingHint : capability.hint}
              </FieldDescription>
            </FieldContent>
            <Switch
              id={id}
              aria-describedby={`${id}-hint`}
              checked={policy[capability.key] && !cappedOff}
              disabled={cappedOff}
              onCheckedChange={(on) => save({ [capability.key]: on })}
            />
          </Field>
        );
      })}

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={`${ids}-max-apps`}>Most apps it may install</FieldLabel>
          <FieldDescription id={`${ids}-max-apps-hint`}>
            Leave empty for no limit. Reaching it stops the next install; it
            never stops editing an app that is already there.
          </FieldDescription>
        </FieldContent>
        <Input
          id={`${ids}-max-apps`}
          className="w-28"
          type="number"
          min={0}
          max={1000}
          aria-describedby={`${ids}-max-apps-hint`}
          defaultValue={policy.maxApps ?? ""}
          onBlur={(event) => {
            const raw = event.target.value.trim();
            const next = raw === "" ? null : Number(raw);
            if (next === policy.maxApps) return;
            if (next !== null && !Number.isFinite(next)) return;
            save({ maxApps: next });
          }}
        />
      </Field>

      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor={`${ids}-hops`}>Agent-to-agent hops</FieldLabel>
          <FieldDescription id={`${ids}-hops-hint`}>
            {policy.serverChainMaxDepth === 0
              ? "Off for the whole server: AGENT_CHAIN_MAX_DEPTH is 0, so only people can start an agent."
              : `How many times agents may hand a request between themselves after a person starts it. 0 means only people start agents. The server caps this at ${policy.serverChainMaxDepth}.`}
          </FieldDescription>
        </FieldContent>
        <Input
          id={`${ids}-hops`}
          className="w-28"
          type="number"
          min={0}
          max={16}
          aria-describedby={`${ids}-hops-hint`}
          disabled={policy.serverChainMaxDepth === 0}
          defaultValue={policy.agentChainMaxDepth}
          onBlur={(event) => {
            const next = Number(event.target.value.trim());
            if (!Number.isInteger(next) || next < 0) return;
            if (next === policy.agentChainMaxDepth) return;
            save({ agentChainMaxDepth: next });
          }}
        />
      </Field>
    </>
  );
}
