/** Installed apps, and the agents this workspace hosts. */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AdminPlugin,
  type AdminPluginCatalog,
  type AdminAgentRun,
  type AdminPluginDelivery,
  type AdminPluginDeliveryDetail,
} from "../../../lib/api.ts";
import { showError } from "../../../lib/toasts.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { ConnectAgentForm } from "../ConnectAgentForm.tsx";
import { DesktopAgentSetup } from "../DesktopAgentSetup.tsx";
import { DeployAgentForm } from "../DeployAgentForm.tsx";
import { useAdminAction } from "../hooks.ts";
import { AppSettings } from "./AppSettings.tsx";
import { InstallAppForm } from "./apps/InstallAppForm.tsx";
import { PluginCard } from "./apps/PluginCard.tsx";

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
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(
    null,
  );
  const [deliveryDetails, setDeliveryDetails] = useState<
    Record<string, AdminPluginDeliveryDetail>
  >({});
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

  // The payload is fetched lazily and kept: a queued delivery's body never changes, so
  // the second expand needs no request. A failed fetch collapses the row again so the
  // next click retries instead of leaving an empty panel open.
  const toggleDelivery = (pluginId: string, deliveryId: string) => {
    const opening = expandedDeliveryId !== deliveryId;
    setExpandedDeliveryId(opening ? deliveryId : null);
    if (opening && !deliveryDetails[deliveryId]) {
      void api.admin
        .pluginDelivery(pluginId, deliveryId)
        .then((detail) =>
          setDeliveryDetails((current) => ({
            ...current,
            [deliveryId]: detail,
          })),
        )
        .catch((err: unknown) => {
          setExpandedDeliveryId((current) =>
            current === deliveryId ? null : current,
          );
          showError(err);
        });
    }
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
            signingSecret={secretNotice.signingSecret ?? null}
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
          onConnected={(pluginName, botToken, signingSecret) => {
            // Both secrets, and they do different jobs. The token is how the agent's
            // bridge authenticates *to* Blob; the signing secret is how the bridge proves
            // to the agent that a run came from Blob. Showing only the token was the bug:
            // the setup it produced could not work against an agent that verifies.
            setSecretNotice({ pluginName, botToken, signingSecret, desktop: true });
            load();
          }}
        />

        <InstallAppForm
          catalog={catalog}
          onError={onError}
          onInstalled={(notice) => {
            setSecretNotice(notice);
            load();
          }}
        />

        {loading && plugins.length === 0 ? (
          <p className="muted">Loading apps…</p>
        ) : (
          <div className="admin-table">
            {plugins.map((plugin) => (
              <PluginCard
                key={plugin.id}
                plugin={plugin}
                expanded={selectedPluginId === plugin.id}
                runs={runs[plugin.id] ?? []}
                deliveries={deliveries[plugin.id] ?? []}
                expandedDeliveryId={expandedDeliveryId}
                deliveryDetails={deliveryDetails}
                act={act}
                onError={onError}
                onSecret={setSecretNotice}
                onToggleActivity={() => toggleActivity(plugin.id)}
                onToggleDelivery={(deliveryId) =>
                  toggleDelivery(plugin.id, deliveryId)
                }
                onUninstall={() => setUninstalling(plugin)}
              />
            ))}
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
