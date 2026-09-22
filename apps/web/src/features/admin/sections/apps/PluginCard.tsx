/** One installed app: its status row, admin actions, and the activity panel. */

import {
  api,
  ApiError,
  type AdminPlugin,
  type AdminAgentRun,
  type AdminPluginDelivery,
  type AdminPluginDeliveryDetail,
} from "../../../../lib/api.ts";
import { useStore } from "../../../../lib/store.ts";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { CardHeading } from "../../../console/Card.tsx";
import { AgentDeployment } from './AgentDeployment.tsx';
import { BudgetRow } from './BudgetRow.tsx';
import { RunLog } from './RunLog.tsx';

export function PluginCard({
  plugin,
  expanded,
  runs,
  deliveries,
  expandedDeliveryId,
  deliveryDetails,
  scopeCatalog,
  act,
  onError,
  onSecret,
  onToggleActivity,
  onToggleDelivery,
  onReplay,
  onUninstall,
}: {
  plugin: AdminPlugin;
  expanded: boolean;
  /** Scope id → human description, from the catalog. Labels the consent screen. */
  scopeCatalog: Record<string, string>;
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
  onReplay: (deliveryId: string) => void;
  onUninstall: () => void;
}) {
  const enabled = plugin.status === "enabled";
  const owner = useStore((state) =>
    plugin.ownerUserId ? state.users[plugin.ownerUserId] : undefined,
  );
  return (
    <div className="admin-plugin-card">
      <div className="admin-row">
        <div className="grow min-0">
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
          <div className="chip-row">
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
            {/* Whose it is, where the list is scanned rather than read: an owned agent
                answers one person, and that is the difference between "quiet" and
                "not yours". Absent for the workspace's own, which is most of them. */}
            {plugin.ownerUserId && (
              <span
                className="role-pill"
                title="Only its owner, and whoever they lend it to, can command this agent"
              >
                {owner ? `${owner.displayName}’s` : "personal"}
              </span>
            )}
            {plugin.events.map((eventName) => (
              <span className="chip" key={eventName}>
                {eventName}
              </span>
            ))}
            {plugin.scopes.map((scope) => (
              <span
                className="chip"
                key={scope}
                data-pending={
                  plugin.pendingScopes.includes(scope) || undefined
                }
                title={
                  plugin.pendingScopes.includes(scope)
                    ? "Requested by an update, not yet approved"
                    : (scopeCatalog[scope] ?? undefined)
                }
              >
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

          {/* The consent screen: which permissions the update added, in words, with
              both answers available. Approving blind was the old shape — a "needs
              review" pill and an Approve button, with the diff only in the audit log.
              Declining is not disabling: the app keeps running on what it had. */}
          {plugin.status === "needs_review" &&
            plugin.pendingScopes.length > 0 && (
              <div className="admin-consent">
                <div className="admin-consent-title">
                  This update asks for new permissions
                </div>
                <ul className="admin-consent-list">
                  {plugin.pendingScopes.map((scope) => (
                    <li key={scope}>
                      <code>{scope}</code>
                      {scopeCatalog[scope] && ` — ${scopeCatalog[scope]}`}
                    </li>
                  ))}
                </ul>
                <div className="admin-consent-actions">
                  <button
                    className="btn btn-primary"
                    onClick={() =>
                      void act(() => api.admin.approvePlugin(plugin.id))
                    }
                  >
                    Approve new permissions
                  </button>
                  <button
                    className="btn"
                    title="The app stays enabled with the permissions it already had"
                    onClick={() =>
                      void act(() =>
                        api.admin.declinePluginScopes(plugin.id),
                      )
                    }
                  >
                    Keep current permissions
                  </button>
                </div>
              </div>
            )}

          <BudgetRow
            key={`${plugin.budgetRunsPerDay ?? "-"}:${plugin.budgetSecondsPerDay ?? "-"}`}
            plugin={plugin}
            act={act}
          />

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
            <p className="error-text admin-plugin-error">{plugin.lastError}</p>
          )}
        </div>

        <div className="admin-row-actions admin-plugin-actions">
          {/* Only when parked with nothing itemised — rows from before pending scopes
              were recorded. Otherwise the consent block above holds both buttons. */}
          {plugin.status === "needs_review" &&
            plugin.pendingScopes.length === 0 && (
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
          {/* Headings of the card this is drawn in, a level under its title: they were
              h5s, which left the page two levels short between that title and these. */}
          <CardHeading>Recent runs</CardHeading>
          <RunLog runs={runs} />

          <CardHeading className="section-label admin-plugin-deliveries-label">
            Deliveries
          </CardHeading>
          {deliveries.length > 0 ? (
            deliveries.map((delivery) => {
              const open = expandedDeliveryId === delivery.id;
              const detail = deliveryDetails[delivery.id];
              return (
                <div className="admin-row" key={delivery.id}>
                  <div className="grow min-0">
                    <button
                      type="button"
                      className="console-row-toggle"
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
                        <div className="console-row-more">
                          <div className="admin-row-meta">
                            {detail.attempts} attempts
                            {detail.lastError &&
                              ` · ${detail.lastError}`}
                            {detail.nextAttemptAt &&
                              ` · next attempt ${formatRelative(detail.nextAttemptAt)}`}
                          </div>
                          {(delivery.status === "failed" ||
                            delivery.status === "dead") && (
                            <button
                              className="btn"
                              type="button"
                              onClick={() => onReplay(delivery.id)}
                            >
                              Replay
                            </button>
                          )}
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
