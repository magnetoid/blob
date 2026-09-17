/** Installed apps, and the agents this workspace hosts. */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AdminPlugin,
  type AdminPluginCatalog,
  type WorkspacePolicy,
} from "../../../lib/api.ts";
import { navigate } from "../../../lib/router.ts";
import { useStore } from "../../../lib/store.ts";
import { Dialog } from "../../../components/Dialog.tsx";
import { EmptyState } from "../../../components/EmptyState.tsx";
import { ConnectAgentForm } from "./apps/ConnectAgentForm.tsx";
import { InstallAppForm } from "./apps/InstallAppForm.tsx";
import { DesktopAgentSetup } from "../../agentic/DesktopAgentSetup.tsx";
import { JanusSetup } from "../../agentic/JanusSetup.tsx";
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
    <AppSettings pluginId={detailId} onError={onError} />
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
  const [activity, setActivity] = useState<{ date: string; runs: number }[]>([]);
  const [policy, setPolicy] = useState<WorkspacePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<InstallPath | null>(null);
  const [secretNotice, setSecretNotice] = useState<SecretNotice | null>(null);
  const workspaceId = useStore((s) => s.workspaceId);

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

  const copySecret = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const installed = plugins.length;
  const runningNow = plugins.reduce((sum, p) => sum + (p.runningNow ?? 0), 0);
  const runsThisWeek = plugins.reduce((sum, p) => sum + (p.runsLastWeek ?? 0), 0);

  return (
    <section>
      <div className="admin-apps-shell">
        <div className="admin-apps-intro">
          <div className="min-0">
            <h2 className="admin-apps-title">Agents</h2>
            <p className="admin-summary muted" aria-live="polite">
              {installed} installed · {runningNow} running now · {runsThisWeek} runs this
              week
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setInstalling("janus")}
          >
            + Install agent
          </button>
        </div>

        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Agents may run</div>
            <div className="pref-hint">
              When off, mentions of agents are refused and nothing is dispatched. Apps
              still receive webhook deliveries.
            </div>
          </div>
          <button
            className="toggle"
            aria-pressed={agentsEnabled}
            aria-label="Agents may run"
            onClick={() =>
              void act(async () => {
                const updated = await api.admin.updateSettings({
                  settings: { agentsEnabled: !agentsEnabled },
                });
                setAgentsEnabled(updated.settings.agentsEnabled !== false);
              })
            }
          >
            <span />
          </button>
        </div>

        {secretNotice && (
          <div className="admin-secret-card">
            <div className="min-0">
              <div className="admin-row-title">{secretNotice.pluginName}</div>
              <div className="admin-row-meta">
                These credentials are shown once. Rotate them later if you lose them.
              </div>
            </div>
            {secretNotice.signingSecret && (
              <div className="draft-chip admin-secret-chip">
                <span className="admin-secret-label">Signing secret</span>
                <code>{secretNotice.signingSecret}</code>
                <button
                  className="btn btn-ghost"
                  onClick={() => void copySecret(secretNotice.signingSecret!)}
                >
                  Copy
                </button>
              </div>
            )}
            {secretNotice.botToken && (
              <div className="draft-chip admin-secret-chip">
                <span className="admin-secret-label">Bot token</span>
                <code>{secretNotice.botToken}</code>
                <button
                  className="btn btn-ghost"
                  onClick={() => void copySecret(secretNotice.botToken!)}
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        )}

        {secretNotice?.setup === "janus" && secretNotice.botToken && (
          <JanusSetup agentName={secretNotice.pluginName} botToken={secretNotice.botToken} />
        )}
        {secretNotice?.setup === "bridge" && secretNotice.botToken && (
          <DesktopAgentSetup
            agentName={secretNotice.pluginName}
            botToken={secretNotice.botToken}
            signingSecret={secretNotice.signingSecret ?? null}
          />
        )}

        <div className="admin-console-grid">
          <div className="min-0">
            {loading && plugins.length === 0 ? (
              <p className="muted">Loading agents…</p>
            ) : plugins.length === 0 ? (
              <EmptyState title="No agents yet" style={{ margin: "32px auto 0" }}>
                Install Janus, connect an agent from your machine, or register an app by
                its URL.
              </EmptyState>
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-table admin-agents">
                  <thead>
                    <tr>
                      <th scope="col">Agent</th>
                      <th scope="col">Access</th>
                      <th scope="col">Runs 7d</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Configure</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {plugins.map((plugin) => (
                      <AgentRow key={plugin.id} plugin={plugin} act={act} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activity.length > 0 && <RunsThisWeek days={activity} />}
          </div>

          <Guardrails policy={policy} />
        </div>
      </div>

      {installing && (
        <Dialog label="Install an agent" onClose={() => setInstalling(null)}>
          <div className="admin-install">
            <div className="chip-row" aria-label="How the agent joins">
              {(
                [
                  ["janus", "Janus"],
                  ["bridge", "Another agent on this machine"],
                  ["app", "An app by URL"],
                ] as const
              ).map(([path, label]) => (
                <button
                  key={path}
                  type="button"
                  className="chip"
                  aria-pressed={installing === path}
                  onClick={() => setInstalling(path)}
                >
                  {label}
                </button>
              ))}
            </div>

            {installing === "janus" && (
              <p className="pref-hint">
                Janus dials Blob itself — no bridge, no public address. Register it here,
                then give it the two values this page prints.
              </p>
            )}
            {installing === "bridge" && (
              <p className="pref-hint">
                Any other AG-UI agent, with the bridge holding Blob's socket beside it.
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
    </section>
  );
}

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
    <tr data-inactive={!enabled}>
      <td>
        <div className="admin-row-title">{plugin.name}</div>
        <div className="admin-row-meta">
          {plugin.description || plugin.slug}
          <span className="role-pill" style={{ marginLeft: 8 }}>
            {plugin.runtime}
          </span>
        </div>
      </td>
      <td className="admin-row-meta">{accessOf(plugin)}</td>
      <td>
        <span>{plugin.runsLastWeek ?? 0}</span>
        {live > 0 && (
          <span className="admin-live" aria-label={`${live} running now`}>
            ● {live} live
          </span>
        )}
      </td>
      <td>
        <span className="role-pill" data-status={plugin.status}>
          {STATUS_LABEL[plugin.status] ?? plugin.status}
        </span>
        {plugin.runtime === "socket" && plugin.online != null && (
          <span className="role-pill" data-online={plugin.online} style={{ marginLeft: 6 }}>
            {plugin.online ? "online" : "offline"}
          </span>
        )}
      </td>
      <td className="admin-row-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void act(() => api.admin.setPluginEnabled(plugin.id, !enabled))}
        >
          {enabled ? "Disable" : "Enable"}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          // The agent every workspace has owns a page of its own — the workspace's half
          // of it, and for the server's admin what Janus runs on. The generic app page
          // shows none of that, so its row goes there instead.
          onClick={() =>
            navigate(
              isSeededJanus(plugin) ? "/admin/janus" : `/admin/apps/${plugin.id}`,
            )
          }
        >
          Configure
        </button>
      </td>
    </tr>
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
    <aside className="admin-guardrails" aria-labelledby="guardrails-title">
      <h3 id="guardrails-title" className="section-label">
        Guardrails
      </h3>
      <ul className="admin-guardrail-list">
        <li>Agents act with the asker's permissions</li>
        {policy && (
          <li>
            Agents may message each other
            {policy.agentChainMaxDepth > 0
              ? ` (max ${policy.agentChainMaxDepth} hops)`
              : " — off"}
          </li>
        )}
        <li className="muted" data-unavailable="true">
          Destructive tools require a human click — not yet available
        </li>
      </ul>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => navigate("/admin/app-policy")}
      >
        App policy
      </button>
    </aside>
  );
}

function RunsThisWeek({ days }: { days: { date: string; runs: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.runs));
  return (
    <section className="admin-chart" aria-labelledby="runs-week-title">
      <h3 id="runs-week-title" className="section-label">
        Runs this week
      </h3>
      <div className="admin-chart-bars" role="img" aria-label={days.map((d) => `${weekday(d.date)} ${d.runs}`).join(", ")}>
        {days.map((day) => (
          <div key={day.date} className="admin-chart-col">
            <div
              className="admin-chart-bar"
              style={{ height: `${Math.round((day.runs / max) * 100)}%` }}
              title={`${day.runs} on ${day.date}`}
            />
            <span className="admin-chart-label">{weekday(day.date)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function weekday(date: string): string {
  // The server's days are UTC dates; label them as such rather than shifting them.
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: "UTC",
  });
}
