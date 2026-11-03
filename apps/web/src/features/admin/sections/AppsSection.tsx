/** Installed apps, and the agents this workspace hosts. */

import { useCallback, useEffect, useId, useState, type CSSProperties } from "react";
import {
  api,
  type AdminPlugin,
  type AdminPluginCatalog,
  type WorkspacePolicy,
} from "../../../lib/api.ts";
import { cn } from "cn";
import { navigate } from "../../../lib/router.ts";
import { useStore } from "../../../lib/store.ts";
import { Dialog, DialogPresence } from "../../../components/Dialog.tsx";
import { EmptyState } from "../../../components/EmptyState.tsx";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../../components/ui/field.tsx";
import { Switch } from "../../../components/ui/switch.tsx";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.tsx";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group.tsx";
import { ConnectAgentForm } from "./apps/ConnectAgentForm.tsx";
import { InstallAppForm } from "./apps/InstallAppForm.tsx";
import { DesktopAgentSetup } from "../../agentic/DesktopAgentSetup.tsx";
import { JanusSetup } from "../../agentic/JanusSetup.tsx";
import { Card, CardNotice, CardTable } from "../../console/Card.tsx";
import { CopyField } from "../../console/CopyField.tsx";
import { useAdminAction } from "../../console/hooks.ts";
import { AppSettings } from "./AppSettings.tsx";
import { isSeededJanus } from "./janus/seeded.ts";

/**
 * /admin/apps is the list; /admin/apps/{id} is one app's settings.
 *
 * The split is a wrapper rather than an early return inside the list, because the list
 * calls hooks — branching above them would change their order between the two routes,
 * and would also leave the list fetching behind a screen nobody is looking at.
 */
export function AppsSection({
  onError,
  detailId,
}: {
  onError: (message: string | null) => void;
  detailId?: string;
}) {
  return detailId ? (
    // Keyed by the app: the router changes the id without remounting this section, and what
    // one app's page holds — a secret shown once, a panel left open — is not the next one's.
    <AppSettings key={detailId} pluginId={detailId} onError={onError} />
  ) : (
    <AppsList onError={onError} />
  );
}

type InstallPath = "janus" | "bridge" | "app";

interface SecretNotice {
  pluginName: string;
  signingSecret?: string;
  botToken?: string;
  /** Which instructions follow the token: Janus dials in itself; the bridge is for any
   * other AG-UI agent; an app by URL needs neither. */
  setup?: "janus" | "bridge";
}

/**
 * The console, as Meadow artboard 2c draws it: one line of numbers, one button, one
 * table, the guardrails beside it and a week of bars under it.
 *
 * It used to be three install forms stacked above a column of cards, each card carrying
 * seven buttons, a budget dial, a consent block and an activity log. Everything per-app
 * now lives on the app's own page — the row here says what the agent is, where it may
 * act, how busy it is and whether it is on, and Configure is the rest. "Deploy from a
 * repository" is no longer an entry point: the container runtime still works for the
 * apps that have it, but the way in is Janus first, the bridge for any other agent, and
 * an app by URL third.
 */
function AppsList({ onError }: { onError: (message: string | null) => void }) {
  const [catalog, setCatalog] = useState<AdminPluginCatalog | null>(null);
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [agentsEnabled, setAgentsEnabled] = useState(true);
  const [activity, setActivity] = useState<{ date: string; runs: number }[]>(
    [],
  );
  const [policy, setPolicy] = useState<WorkspacePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<InstallPath | null>(null);
  const [secretNotice, setSecretNotice] = useState<SecretNotice | null>(null);
  const workspaceId = useStore((s) => s.workspaceId);
  const switchId = useId();

  const load = useCallback(() => {
    setLoading(true);
    void Promise.all([
      api.admin.pluginCatalog(),
      api.admin.plugins(),
      api.admin.settings(),
      api.admin.activity().catch(() => ({ days: [] })),
    ])
      .then(([nextCatalog, nextPlugins, settings, nextActivity]) => {
        setCatalog(nextCatalog);
        setPlugins(nextPlugins.plugins);
        setAgentsEnabled(settings.settings.agentsEnabled !== false);
        setActivity(nextActivity.days);
      })
      .catch(() => onError("Could not load apps."))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);

  // The guardrails are instance policy, which a workspace admin who is not the instance
  // owner may not read. The panel then shows what is always true and links to the page
  // that holds the rest, rather than failing the whole list over a 403.
  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    void api.admin
      .workspacePolicy(workspaceId)
      .then((next) => {
        if (live) setPolicy(next);
      })
      .catch(() => {
        if (live) setPolicy(null);
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const act = useAdminAction(onError, load);

  const installed = plugins.length;
  const runningNow = plugins.reduce((sum, p) => sum + (p.runningNow ?? 0), 0);
  const runsThisWeek = plugins.reduce(
    (sum, p) => sum + (p.runsLastWeek ?? 0),
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Credentials first: they are shown once, and the page opens here straight after
          the install dialog closes. */}
      {secretNotice && (
        <Card
          title={`New credentials for ${secretNotice.pluginName}`}
          description="These credentials are shown once. Rotate them later if you lose them."
        >
          {secretNotice.signingSecret && (
            <CopyField label="Signing secret" value={secretNotice.signingSecret} />
          )}
          {secretNotice.botToken && (
            <CopyField label="Bot token" value={secretNotice.botToken} />
          )}
        </Card>
      )}

      {/* What these two print is the agents console's own markup (`features/agentic/`),
          drawn by the legacy stylesheet. */}
      {secretNotice?.setup === "janus" && secretNotice.botToken && (
        <div data-legacy>
          <JanusSetup
            agentName={secretNotice.pluginName}
            botToken={secretNotice.botToken}
          />
        </div>
      )}
      {secretNotice?.setup === "bridge" && secretNotice.botToken && (
        <div data-legacy>
          <DesktopAgentSetup
            agentName={secretNotice.pluginName}
            botToken={secretNotice.botToken}
            signingSecret={secretNotice.signingSecret ?? null}
          />
        </div>
      )}

      {/* Side by side only when the table keeps room for its five columns; below that the
          guardrails follow it. Asked of the page's column rather than the window, because
          the nav takes 240px of the window at one width and none of it at the next. */}
      <div className="grid items-start gap-6 @min-[961px]/console-page:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card
            title="Agents"
            description={
              <span className="tabular-nums" aria-live="polite">
                {installed} installed · {runningNow} running now · {runsThisWeek}{" "}
                runs this week
              </span>
            }
            actions={
              <Button type="button" onClick={() => setInstalling("janus")}>
                + Install agent
              </Button>
            }
          >
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={switchId}>Agents may run</FieldLabel>
                <FieldDescription id={`${switchId}-hint`}>
                  When off, mentions of agents are refused and nothing is
                  dispatched. Apps still receive webhook deliveries.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={switchId}
                aria-describedby={`${switchId}-hint`}
                checked={agentsEnabled}
                onCheckedChange={(on) =>
                  void act(async () => {
                    const updated = await api.admin.updateSettings({
                      settings: { agentsEnabled: on },
                    });
                    setAgentsEnabled(updated.settings.agentsEnabled !== false);
                  })
                }
              />
            </Field>

            {loading && plugins.length === 0 ? (
              <CardNotice>Loading agents…</CardNotice>
            ) : plugins.length === 0 ? (
              <EmptyState title="No agents yet">
                Install Janus, connect an agent from your machine, or register
                an app by its URL.
              </EmptyState>
            ) : (
              <CardTable label="Agents">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Agent</TableHead>
                    <TableHead scope="col">Access</TableHead>
                    <TableHead scope="col" className="text-right">
                      Runs 7d
                    </TableHead>
                    <TableHead scope="col">Status</TableHead>
                    <TableHead scope="col">
                      <span className="sr-only">Configure</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plugins.map((plugin) => (
                    <AgentRow key={plugin.id} plugin={plugin} act={act} />
                  ))}
                </TableBody>
              </CardTable>
            )}
          </Card>

          {activity.length > 0 && <RunsThisWeek days={activity} />}
        </div>

        <Guardrails policy={policy} />
      </div>

      <DialogPresence when={installing}>
        {(installing) => (
          <Dialog label="Install an agent" onClose={() => setInstalling(null)}>
            <div className="flex min-w-[min(560px,calc(100vw-48px))] flex-col gap-3.5">
              {/* One way in is chosen at a time, and pressing the one that is chosen
                  would leave none. */}
              <ToggleGroup
                aria-label="How the agent joins"
                variant="outline"
                className="flex-wrap"
                value={[installing]}
                onValueChange={([next]) => {
                  const chosen = INSTALL_PATHS.find(([path]) => path === next);
                  if (chosen) setInstalling(chosen[0]);
                }}
              >
                {INSTALL_PATHS.map(([path, label]) => (
                  <ToggleGroupItem key={path} value={path}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {installing === "janus" && (
                <p className="m-0 text-sm text-muted-foreground">
                  Janus dials Blob itself — no bridge, no public address. Register
                  it here, then give it the two values this page prints.
                </p>
              )}
              {installing === "bridge" && (
                <p className="m-0 text-sm text-muted-foreground">
                  Any other AG-UI agent, with the bridge holding Blob's socket
                  beside it.
                </p>
              )}

              {installing === "app" ? (
                <InstallAppForm
                  catalog={catalog}
                  onError={onError}
                  onInstalled={(notice) => {
                    setSecretNotice(notice);
                    setInstalling(null);
                    load();
                  }}
                />
              ) : (
                <ConnectAgentForm
                  scopeCatalog={catalog?.scopes ?? {}}
                  onError={onError}
                  onConnected={(pluginName, botToken, signingSecret) => {
                    setSecretNotice({
                      pluginName,
                      botToken,
                      signingSecret,
                      setup: installing === "janus" ? "janus" : "bridge",
                    });
                    setInstalling(null);
                    load();
                  }}
                />
              )}
            </div>
          </Dialog>
        )}
      </DialogPresence>
    </div>
  );
}

/** The three ways in, in the order they are offered: Janus first. */
const INSTALL_PATHS = [
  ["janus", "Janus"],
  ["bridge", "Another agent on this machine"],
  ["app", "An app by URL"],
] as const satisfies readonly (readonly [InstallPath, string])[];

/** What the agent may reach, in a sentence. The scopes themselves are on its page. */
function accessOf(plugin: AdminPlugin): string {
  const n = plugin.channelCount ?? 0;
  const where = n === 1 ? "1 channel" : `${n} channels`;
  const readOnly = !plugin.scopes.includes("messages:write");
  return readOnly ? `${where} · read-only` : where;
}

const STATUS_LABEL: Record<AdminPlugin["status"], string> = {
  enabled: "enabled",
  disabled: "disabled",
  needs_review: "needs review",
  failed: "failed",
};

function AgentRow({
  plugin,
  act,
}: {
  plugin: AdminPlugin;
  act: (run: () => Promise<unknown>) => Promise<void>;
}) {
  const enabled = plugin.status === "enabled";
  const live = plugin.runningNow ?? 0;
  return (
    // An agent that is off goes grey, and its badge says why.
    <TableRow className={cn(!enabled && "text-muted-foreground")}>
      <TableCell className="align-top whitespace-normal">
        <div className="font-medium">{plugin.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {plugin.description || plugin.slug}
          <Badge variant="outline">{plugin.runtime}</Badge>
        </div>
      </TableCell>
      <TableCell className="align-top text-sm whitespace-normal text-muted-foreground">
        {accessOf(plugin)}
      </TableCell>
      <TableCell className="text-right align-top tabular-nums">
        <span>{plugin.runsLastWeek ?? 0}</span>
        {live > 0 && (
          // A run in flight. The one thing on the page worth a glance.
          <Badge
            variant="secondary"
            className="ml-2"
            role="img"
            aria-label={`${live} running now`}
          >
            ● {live} live
          </Badge>
        )}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap gap-1.5">
          <Badge
            variant={
              enabled
                ? "secondary"
                : plugin.status === "failed"
                  ? "destructive"
                  : "outline"
            }
          >
            {STATUS_LABEL[plugin.status] ?? plugin.status}
          </Badge>
          {plugin.runtime === "socket" && plugin.online != null && (
            <Badge variant={plugin.online ? "secondary" : "outline"}>
              {plugin.online ? "online" : "offline"}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            aria-label={`${enabled ? "Disable" : "Enable"} ${plugin.name}`}
            onClick={() =>
              void act(() => api.admin.setPluginEnabled(plugin.id, !enabled))
            }
          >
            {enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Configure ${plugin.name}`}
            // The agent every workspace has owns a page of its own — the workspace's half
            // of it, and for the server's admin what Janus runs on. The generic app page
            // shows none of that, so its row goes there instead.
            onClick={() =>
              navigate(
                isSeededJanus(plugin)
                  ? "/admin/janus"
                  : `/admin/apps/${plugin.id}`,
              )
            }
          >
            Configure
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Three statements, and honest about which are live. The first is ADR 0013 and has no
 * switch; the second is policy an instance owner edits on the App policy page; the
 * last does not exist yet — `agent_write_approval` is in the roadmap and nowhere else —
 * and a tick that does nothing is worse than no tick.
 */
function Guardrails({ policy }: { policy: WorkspacePolicy | null }) {
  return (
    <Card title="Guardrails">
      <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm">
        <li>Agents act with the asker's permissions</li>
        {policy && (
          <li>
            Agents may message each other
            {policy.agentChainMaxDepth > 0
              ? ` (max ${policy.agentChainMaxDepth} hops)`
              : " — off"}
          </li>
        )}
        {/* Not live yet, and said so in words; the muted colour is the only dimming,
            because opacity on top of it took the line under 4.5:1. */}
        <li className="list-[circle] text-muted-foreground">
          Destructive tools require a human click — not yet available
        </li>
      </ul>
      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => navigate("/server/app-policy")}
      >
        App policy
      </Button>
    </Card>
  );
}

function RunsThisWeek({ days }: { days: { date: string; runs: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.runs));
  return (
    <Card title="Runs this week">
      <div
        className="mt-2 grid h-24 grid-cols-7 items-end gap-2"
        role="img"
        aria-label={days.map((d) => `${weekday(d.date)} ${d.runs}`).join(", ")}
      >
        {days.map((day) => (
          <div key={day.date} className="flex h-full min-h-0 flex-col items-center justify-end gap-1.5">
            {/* The height is the day's share of the busiest day, so it is data and rides
                in a custom property: the bar fills what the label leaves of its column
                (`flex-1`) and is scaled from the bottom by that share. */}
            <div
              className="min-h-0.5 w-full flex-1 origin-bottom scale-y-(--bar-scale) rounded-t-sm bg-primary transition-transform duration-(--dur-open) ease-(--ease-standard) motion-reduce:transition-none"
              style={
                {
                  "--bar-scale": day.runs / max,
                } as CSSProperties
              }
              title={`${day.runs} on ${day.date}`}
            />
            <span className="text-xs text-muted-foreground">{weekday(day.date)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function weekday(date: string): string {
  // The server's days are UTC dates; label them as such rather than shifting them.
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
}
