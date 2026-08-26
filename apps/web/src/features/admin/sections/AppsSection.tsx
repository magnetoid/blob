/** Installed apps, and the agents this workspace hosts. */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  type AdminPlugin,
  type AdminPluginCatalog,
  type AdminAgentRun,
  type AdminPluginDelivery,
} from "../../../lib/api.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { AgentDeployment } from "../AgentDeployment.tsx";
import { ConnectAgentForm } from "../ConnectAgentForm.tsx";
import { DesktopAgentSetup } from "../DesktopAgentSetup.tsx";
import { DeployAgentForm } from "../DeployAgentForm.tsx";
import { useAdminAction } from "../hooks.ts";
import { AppSettings } from "./AppSettings.tsx";

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

function AppsList({
  onError,
}: {
  onError: (message: string | null) => void;
}) {

  const [catalog, setCatalog] = useState<AdminPluginCatalog | null>(null);
  const [plugins, setPlugins] = useState<AdminPlugin[]>([]);
  const [deliveries, setDeliveries] = useState<
    Record<string, AdminPluginDelivery[]>
  >({});
  const [runs, setRuns] = useState<Record<string, AdminAgentRun[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<AdminPlugin | null>(null);
  const [secretNotice, setSecretNotice] = useState<{
    pluginName: string;
    signingSecret?: string;
    botToken?: string;
    //: Set for a socket agent, whose token is not just a credential to keep but the
    //: thing you paste into the bridge. Only that path gets the setup instructions.
    desktop?: boolean;
  } | null>(null);
  const [form, setForm] = useState({
    slug: "",
    name: "",
    description: "",
    version: "1.0.0",
    requestUrl: "",
    aguiUrl: "",
    events: [] as string[],
    scopes: [] as string[],
  });

  const load = useCallback(() => {
    setLoading(true);
    void Promise.all([api.admin.pluginCatalog(), api.admin.plugins()])
      .then(([nextCatalog, nextPlugins]) => {
        setCatalog(nextCatalog);
        setPlugins(nextPlugins.plugins);
      })
      .catch(() => onError("Could not load apps."))
      .finally(() => setLoading(false));
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAdminAction(onError, load);

  const copySecret = async (value: string) => {
    await navigator.clipboard.writeText(value);
  };

  const loadDeliveries = async (pluginId: string) => {
    try {
      const response = await api.admin.pluginDeliveries(pluginId);
      setDeliveries((current) => ({
        ...current,
        [pluginId]: response.deliveries,
      }));
    } catch {
      onError("Could not load delivery attempts.");
    }
  };

  const loadRuns = async (pluginId: string) => {
    try {
      const response = await api.admin.pluginRuns(pluginId);
      setRuns((current) => ({ ...current, [pluginId]: response.runs }));
    } catch {
      onError("Could not load recent runs.");
    }
  };

  // Both, on one click. "Did the app hear us" and "did it manage to reply" are the same
  // question to whoever is looking, and an app only ever has one of the two logs anyway:
  // deliveries are for webhook apps, runs for agents.
  const toggleActivity = (pluginId: string) => {
    setSelectedPluginId((current) => (current === pluginId ? null : pluginId));
    if (!deliveries[pluginId]) void loadDeliveries(pluginId);
    if (!runs[pluginId]) void loadRuns(pluginId);
  };

  return (
    <section>
      <div className="admin-apps-shell">
        <div className="admin-apps-intro">
          <div>
            <h2 className="admin-apps-title">
              External apps and agent endpoints
            </h2>
            <p className="pref-hint" style={{ margin: "6px 0 0" }}>
              Register HTTPS endpoints, grant only the scopes they need, and
              keep every secret rotation and delivery attempt visible to admins.
            </p>
          </div>
          <div className="role-pill">zero-trust</div>
        </div>

        {secretNotice && (
          <div className="admin-secret-card">
            <div style={{ minWidth: 0 }}>
              <div className="admin-row-title">{secretNotice.pluginName}</div>
              <div className="admin-row-meta">
                These credentials are shown once. Rotate them later if you lose
                them.
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

        {secretNotice?.desktop && secretNotice.botToken && (
          <DesktopAgentSetup
            agentName={secretNotice.pluginName}
            botToken={secretNotice.botToken}
          />
        )}

        <DeployAgentForm
          scopeCatalog={catalog?.scopes ?? {}}
          onError={onError}
          onInstalled={(pluginName, signingSecret, botToken) => {
            setSecretNotice({ pluginName, signingSecret, botToken });
            load();
          }}
        />

        <ConnectAgentForm
          scopeCatalog={catalog?.scopes ?? {}}
          onError={onError}
          onConnected={(pluginName, botToken) => {
            // No signing secret: nothing is going to POST to this agent, so there is
            // nothing for it to verify. The token is both how it connects and how it
            // calls back.
            setSecretNotice({ pluginName, botToken, desktop: true });
            load();
          }}
        />

        <form
          className="admin-app-form"
          onSubmit={(event) => {
            event.preventDefault();
            onError(null);
            void api.admin
              .installPlugin({
                slug: form.slug.trim(),
                name: form.name.trim(),
                description: form.description.trim() || null,
                runtime: "external",
                version: form.version.trim() || "1.0.0",
                requestUrl: form.requestUrl.trim() || null,
                aguiUrl: form.aguiUrl.trim() || null,
                events: form.events,
                scopes: form.scopes,
              })
              .then((installed) => {
                setSecretNotice({
                  pluginName: installed.plugin.name,
                  signingSecret: installed.signingSecret,
                  botToken: installed.botToken,
                });
                setForm({
                  slug: "",
                  name: "",
                  description: "",
                  version: "1.0.0",
                  requestUrl: "",
                  aguiUrl: "",
                  events: [],
                  scopes: [],
                });
                load();
              })
              .catch((err) => {
                onError(
                  err instanceof ApiError
                    ? err.message
                    : "Could not install the app.",
                );
              });
          }}
        >
          <label className="field">
            <span className="field-label">Slug</span>
            <input
              className="input"
              value={form.slug}
              onChange={(e) =>
                setForm((current) => ({ ...current, slug: e.target.value }))
              }
              placeholder="standup-bot"
              required
            />
          </label>
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={form.name}
              onChange={(e) =>
                setForm((current) => ({ ...current, name: e.target.value }))
              }
              placeholder="Standup Bot"
              required
            />
          </label>
          <label className="field admin-app-form-wide">
            <span className="field-label">Description</span>
            <input
              className="input"
              value={form.description}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  description: e.target.value,
                }))
              }
              placeholder="Collects standup notes every morning"
            />
          </label>
          <label className="field">
            <span className="field-label">Version</span>
            <input
              className="input"
              value={form.version}
              onChange={(e) =>
                setForm((current) => ({ ...current, version: e.target.value }))
              }
              placeholder="1.0.0"
              required
            />
          </label>
          <label className="field admin-app-form-wide">
            <span className="field-label">Request URL</span>
            <input
              className="input"
              type="url"
              value={form.requestUrl}
              onChange={(e) =>
                setForm((current) => ({
                  ...current,
                  requestUrl: e.target.value,
                }))
              }
              placeholder="https://apps.example.com/blob/events"
            />
            <span className="pref-hint">
              Where Blob POSTs the events this app subscribed to.
            </span>
          </label>
          <label className="field admin-app-form-wide">
            <span className="field-label">AG-UI URL</span>
            <input
              className="input"
              type="url"
              value={form.aguiUrl}
              onChange={(e) =>
                setForm((current) => ({ ...current, aguiUrl: e.target.value }))
              }
              placeholder="https://agent.example.com/agui"
            />
            <span className="pref-hint">
              For an agent that speaks AG-UI. Blob calls it when someone mentions the
              app, and posts what it streams back — no webhook handler needed. Give one
              of these two URLs, or both.
            </span>
          </label>

          <div className="admin-app-permissions">
            <div>
              <div className="section-label" style={{ paddingLeft: 0 }}>
                Event subscriptions
              </div>
              <div className="admin-check-grid">
                {catalog &&
                  Object.entries(catalog.events).map(
                    ([eventKey, description]) => (
                      <label className="admin-check-card" key={eventKey}>
                        <input
                          type="checkbox"
                          aria-label={eventKey}
                          checked={form.events.includes(eventKey)}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              events: toggleChoice(current.events, eventKey),
                            }))
                          }
                        />
                        <span>
                          <strong>{eventKey}</strong>
                          <small>{description}</small>
                        </span>
                      </label>
                    ),
                  )}
              </div>
            </div>
            <div>
              <div className="section-label" style={{ paddingLeft: 0 }}>
                Granted scopes
              </div>
              <div className="admin-check-grid">
                {catalog &&
                  Object.entries(catalog.scopes).map(
                    ([scopeKey, description]) => (
                      <label className="admin-check-card" key={scopeKey}>
                        <input
                          type="checkbox"
                          aria-label={scopeKey}
                          checked={form.scopes.includes(scopeKey)}
                          onChange={() =>
                            setForm((current) => ({
                              ...current,
                              scopes: toggleChoice(current.scopes, scopeKey),
                            }))
                          }
                        />
                        <span>
                          <strong>{scopeKey}</strong>
                          <small>{description}</small>
                        </span>
                      </label>
                    ),
                  )}
              </div>
            </div>
          </div>

          <div className="admin-app-form-actions">
            <div className="pref-hint">
              Blob only installs external apps here. Local plugins remain
              deploy-time code.
            </div>
            <button className="btn btn-primary" type="submit">
              Install app
            </button>
          </div>
        </form>

        {loading && plugins.length === 0 ? (
          <p className="muted">Loading apps…</p>
        ) : (
          <div className="admin-table">
            {plugins.map((plugin) => {
              const expanded = selectedPluginId === plugin.id;
              const pluginDeliveries = deliveries[plugin.id] ?? [];
              const enabled = plugin.status === "enabled";
              return (
                <div className="admin-plugin-card" key={plugin.id}>
                  <div className="admin-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="admin-row-title">
                        {plugin.name}
                        <span className="role-pill">
                          {plugin.status.replace("_", " ")}
                        </span>
                        <span className="role-pill" data-muted>
                          v{plugin.version}
                        </span>
                      </div>
                      <div className="admin-row-meta">
                        {plugin.description || plugin.slug}
                        {(plugin.aguiUrl || plugin.requestUrl) &&
                          ` · ${plugin.aguiUrl ?? plugin.requestUrl}`}
                        {plugin.botUserId && ` · bot user ${plugin.botUserId}`}
                      </div>
                      <div className="chip-row" style={{ marginTop: 10 }}>
                        {plugin.events.map((eventName) => (
                          <span className="chip" key={eventName}>
                            {eventName}
                          </span>
                        ))}
                        {plugin.scopes.map((scope) => (
                          <span className="chip" key={scope}>
                            {scope}
                          </span>
                        ))}
                        {plugin.pendingDeliveries > 0 && (
                          <span className="role-pill" data-muted>
                            {plugin.pendingDeliveries} pending
                          </span>
                        )}
                        {plugin.failedDeliveries > 0 && (
                          <span className="role-pill">
                            {plugin.failedDeliveries} failed
                          </span>
                        )}
                      </div>
                      {plugin.runtime === "container" && (
                        <AgentDeployment
                          pluginId={plugin.id}
                          repo={plugin.sourceRepo ?? null}
                          gitRef={plugin.sourceRef ?? null}
                          onError={onError}
                        />
                      )}

                      {plugin.lastError && (
                        <p
                          className="error-text"
                          style={{ margin: "10px 0 0" }}
                        >
                          {plugin.lastError}
                        </p>
                      )}
                    </div>

                    <div className="admin-row-actions admin-plugin-actions">
                      {plugin.status === "needs_review" && (
                        <button
                          className="btn btn-primary"
                          onClick={() =>
                            void act(() => api.admin.approvePlugin(plugin.id))
                          }
                        >
                          Approve
                        </button>
                      )}
                      <button
                        className="btn"
                        onClick={() =>
                          void act(() =>
                            api.admin.setPluginEnabled(plugin.id, !enabled),
                          )
                        }
                      >
                        {enabled ? "Disable" : "Enable"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => toggleActivity(plugin.id)}
                      >
                        {expanded ? "Hide activity" : "Show activity"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          onError(null);
                          void api.admin
                            .rotatePluginSecret(plugin.id)
                            .then((result) =>
                              setSecretNotice({
                                pluginName: plugin.name,
                                signingSecret: result.signingSecret,
                              }),
                            )
                            .catch((err) =>
                              onError(
                                err instanceof ApiError
                                  ? err.message
                                  : "Could not rotate the signing secret.",
                              ),
                            );
                        }}
                      >
                        Rotate secret
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          onError(null);
                          void api.admin
                            .issuePluginToken(plugin.id)
                            .then((result) =>
                              setSecretNotice({
                                pluginName: plugin.name,
                                botToken: result.botToken,
                              }),
                            )
                            .catch((err) =>
                              onError(
                                err instanceof ApiError
                                  ? err.message
                                  : "Could not issue a bot token.",
                              ),
                            );
                        }}
                      >
                        Issue token
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() =>
                          void act(() =>
                            api.admin.revokePluginTokens(plugin.id),
                          )
                        }
                      >
                        Revoke tokens
                      </button>
                      <button
                        className="btn"
                        onClick={() => setUninstalling(plugin)}
                      >
                        Uninstall
                      </button>
                    </div>
                  </div>

                  {expanded && (
                    <div className="admin-plugin-deliveries">
                      <h5 className="section-label">Recent runs</h5>
                      {(runs[plugin.id] ?? []).length > 0 ? (
                        (runs[plugin.id] ?? []).map((run) => (
                          <div className="admin-row" key={run.id}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="admin-row-title">
                                {run.channelName ? `#${run.channelName}` : "a channel"}
                                {/* Not muted for `interrupted`: the agent is waiting for
                                    a person, which is the one outcome somebody can act
                                    on, and greying it would read as "nothing to do". */}
                                <span
                                  className="role-pill"
                                  data-muted={
                                    run.status !== "succeeded" &&
                                    run.status !== "interrupted"
                                  }
                                >
                                  {run.status}
                                </span>
                              </div>
                              <div className="admin-row-meta">
                                {run.triggerUserName ?? "someone"} asked ·{" "}
                                {formatRelative(run.startedAt)}
                                {run.durationMs !== null &&
                                  ` · ${run.durationMs} ms`}
                                {` · ${run.postCount} ${run.postCount === 1 ? "reply" : "replies"}`}
                                {run.transport === "socket" && " · over its own socket"}
                                {run.error && ` · ${run.error}`}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="muted">
                          This app has not been asked anything yet.
                        </p>
                      )}

                      <h5 className="section-label" style={{ marginTop: 14 }}>
                        Deliveries
                      </h5>
                      {pluginDeliveries.length > 0 ? (
                        pluginDeliveries.map((delivery) => (
                          <div className="admin-row" key={delivery.id}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="admin-row-title">
                                {delivery.event}
                                <span
                                  className="role-pill"
                                  data-muted={delivery.status !== "delivered"}
                                >
                                  {delivery.status}
                                </span>
                              </div>
                              <div className="admin-row-meta">
                                {delivery.attempts} attempts · created{" "}
                                {formatRelative(delivery.createdAt)}
                                {delivery.deliveredAt &&
                                  ` · delivered ${formatRelative(delivery.deliveredAt)}`}
                                {delivery.lastStatusCode &&
                                  ` · HTTP ${delivery.lastStatusCode}`}
                                {delivery.lastError &&
                                  ` · ${delivery.lastError}`}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="muted">
                          No delivery attempts recorded yet.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {plugins.length === 0 && (
              <div className="empty-state" style={{ margin: "32px auto 0" }}>
                <div className="empty-state-title">No apps installed yet</div>
                <div className="empty-state-body">
                  Register an external app to connect project tools, bots, or
                  internal agent services into this workspace.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {uninstalling && (
        <ConfirmDialog
          title={`Uninstall ${uninstalling.name}?`}
          body="Its tokens stop working and it stops receiving events. Messages it posted stay."
          confirmLabel="Uninstall"
          danger
          onClose={() => setUninstalling(null)}
          onConfirm={() => {
            const plugin = uninstalling;
            setUninstalling(null);
            void act(() => api.admin.uninstallPlugin(plugin.id));
          }}
        />
      )}
    </section>
  );
}

function toggleChoice(items: string[], value: string): string[] {
  return items.includes(value)
    ? items.filter((item) => item !== value)
    : [...items, value];
}
