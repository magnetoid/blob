/** One installed app: its status row, admin actions, and the activity panel. */

import {
  api,
  ApiError,
  type AdminPlugin,
  type AdminAgentRun,
  type AdminPluginDelivery,
  type AdminPluginDeliveryDetail,
} from "../../../../lib/api.ts";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { AgentDeployment } from "../../AgentDeployment.tsx";

export function PluginCard({
  plugin,
  expanded,
  runs,
  deliveries,
  expandedDeliveryId,
  deliveryDetails,
  act,
  onError,
  onSecret,
  onToggleActivity,
  onToggleDelivery,
  onUninstall,
}: {
  plugin: AdminPlugin;
  expanded: boolean;
  runs: AdminAgentRun[];
  deliveries: AdminPluginDelivery[];
  expandedDeliveryId: string | null;
  deliveryDetails: Record<string, AdminPluginDeliveryDetail>;
  act: (run: () => Promise<unknown>) => Promise<void>;
  onError: (message: string | null) => void;
  onSecret: (notice: {
    pluginName: string;
    signingSecret?: string;
    botToken?: string;
  }) => void;
  onToggleActivity: () => void;
  onToggleDelivery: (deliveryId: string) => void;
  onUninstall: () => void;
}) {
  const enabled = plugin.status === "enabled";
  return (
    <div className="admin-plugin-card">
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
            {/* Only ever shown for an agent that dials in, where it is the
                difference between "set up wrong" and "the laptop is asleep".
                Until this existed the only way to find out was to mention the
                agent and see whether anything came back. */}
            {plugin.online !== null && plugin.online !== undefined && (
              <span
                className="role-pill"
                data-muted={!plugin.online}
                title={
                  plugin.online
                    ? "Holding a connection to Blob"
                    : "Not connected — start the bridge next to the agent"
                }
              >
                {plugin.online ? "connected" : "not connected"}
              </span>
            )}
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
              agentName={plugin.name}
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
            onClick={onToggleActivity}
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
                  onSecret({
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
                  onSecret({
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
            onClick={onUninstall}
          >
            Uninstall
          </button>
        </div>
      </div>

      {expanded && (
        <div className="admin-plugin-deliveries">
          <h5 className="section-label">Recent runs</h5>
          {runs.length > 0 ? (
            runs.map((run) => (
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
          {deliveries.length > 0 ? (
            deliveries.map((delivery) => {
              const open = expandedDeliveryId === delivery.id;
              const detail = deliveryDetails[delivery.id];
              return (
                <div className="admin-row" key={delivery.id}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <button
                      type="button"
                      style={{ width: "100%", textAlign: "left" }}
                      onClick={() => onToggleDelivery(delivery.id)}
                      aria-expanded={open}
                    >
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
                    </button>
                    {open &&
                      (detail ? (
                        <div style={{ padding: "4px 0 14px" }}>
                          <div className="admin-row-meta">
                            {detail.attempts} attempts
                            {detail.lastError &&
                              ` · ${detail.lastError}`}
                            {detail.nextAttemptAt &&
                              ` · next attempt ${formatRelative(detail.nextAttemptAt)}`}
                          </div>
                          <pre className="log-detail">
                            {JSON.stringify(
                              detail.payload,
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      ) : (
                        <p className="muted">Loading delivery…</p>
                      ))}
                  </div>
                </div>
              );
            })
          ) : (
            <p className="muted">
              No delivery attempts recorded yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
