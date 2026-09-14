/** One app's settings.
 *
 * The list answers "what is installed"; this answers "why is it not doing anything",
 * which until now had no screen at all. The load-bearing part is the channel list: an
 * installed app is inert until its bot is a member somewhere, and an app that answers
 * over AG-UI never calls Blob on its own, so it cannot join for itself the way a webhook
 * app can. Before this, installing an agent produced something that looked installed and
 * spoke nowhere, with nothing on screen to say why.
 */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  type AdminAgentRun,
  type AdminPlugin,
  type AdminPluginCatalog,
  type AdminPluginDelivery,
  type AdminPluginDeliveryDetail,
  type AppChannel,
} from "../../../lib/api.ts";
import { navigate } from "../../../lib/router.ts";
import { useStore } from "../../../lib/store.ts";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';
import { byDisplayName } from "../../../lib/format.ts";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { showError } from "../../../lib/toasts.ts";
import { PluginCard } from "./apps/PluginCard.tsx";
import { JanusSetup } from "../../agentic/JanusSetup.tsx";
import { DesktopAgentSetup } from "../../agentic/DesktopAgentSetup.tsx";

interface Props {
  pluginId: string;
  onError: (message: string | null) => void;
}

export function AppSettings({ pluginId, onError }: Props) {
  const [plugin, setPlugin] = useState<AdminPlugin | null>(null);
  const [channels, setChannels] = useState<AppChannel[]>([]);
  const [catalog, setCatalog] = useState<AdminPluginCatalog | null>(null);
  const users = useStore((s) => s.users);

  // Everything per-app that the list used to carry on a card lives here now: the
  // budget dial, the consent block, the credential buttons, the activity log and
  // uninstall. The list is a table of rows; this is the page a row's Configure opens.
  const [runs, setRuns] = useState<AdminAgentRun[]>([]);
  const [deliveries, setDeliveries] = useState<AdminPluginDelivery[]>([]);
  const [expandedDeliveryId, setExpandedDeliveryId] = useState<string | null>(null);
  const [deliveryDetails, setDeliveryDetails] = useState<
    Record<string, AdminPluginDeliveryDetail>
  >({});
  const [secretNotice, setSecretNotice] = useState<{
    pluginName: string;
    signingSecret?: string;
    botToken?: string;
  } | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  const load = useCallback(async () => {
    const [all, listed, nextCatalog] = await Promise.all([
      api.admin.plugins(),
      api.admin.appChannels(pluginId),
      api.admin.pluginCatalog().catch(() => null),
    ]);
    setPlugin(all.plugins.find((row) => row.id === pluginId) ?? null);
    setChannels(listed.channels);
    setCatalog(nextCatalog);
    return listed;
  }, [pluginId]);

  // The activity log, on arrival rather than on a click: this page *is* the expanded
  // card. "Did the app hear us" and "did it manage to reply" are one question to
  // whoever is looking, and an app only ever has one of the two logs anyway.
  useEffect(() => {
    let live = true;
    void api.admin
      .pluginRuns(pluginId)
      .then((response) => {
        if (live) setRuns(response.runs);
      })
      .catch(() => onError("Could not load recent runs."));
    void api.admin
      .pluginDeliveries(pluginId)
      .then((response) => {
        if (live) setDeliveries(response.deliveries);
      })
      .catch(() => onError("Could not load delivery attempts."));
    return () => {
      live = false;
    };
  }, [pluginId, onError]);

  // A queued delivery's body never changes, so the second expand needs no request; a
  // failed fetch collapses the row so the next click retries rather than leaving an
  // empty panel open.
  const toggleDelivery = (deliveryId: string) => {
    const opening = expandedDeliveryId !== deliveryId;
    setExpandedDeliveryId(opening ? deliveryId : null);
    if (opening && !deliveryDetails[deliveryId]) {
      void api.admin
        .pluginDelivery(pluginId, deliveryId)
        .then((detail) =>
          setDeliveryDetails((current) => ({ ...current, [deliveryId]: detail })),
        )
        .catch((err: unknown) => {
          setExpandedDeliveryId((current) => (current === deliveryId ? null : current));
          showError(err);
        });
    }
  };

  const { loading, reload } = useAdminData(
    load,
    [pluginId],
    onError,
    "Could not load that app.",
  );
  const act = useAdminAction(onError, reload);

  if (loading && !plugin) return <p className="pref-hint">Loading…</p>;
  if (!plugin)
    return <p className="pref-hint">That app is not installed here.</p>;

  const endpoint = plugin.aguiUrl ?? plugin.requestUrl;
  const joined = channels.filter((channel) => channel.joined);
  // Bots cannot own an agent — the server refuses one, and offering it here would be a
  // control that only ever produces an error.
  const owner = plugin.ownerUserId ? users[plugin.ownerUserId] : undefined;
  const people = Object.values(users)
    // A deactivated owner still has to appear, or the select falls back to its first
    // option and the screen claims the workspace owns an agent that it does not.
    .filter(
      (person) =>
        person.kind !== "bot" &&
        (!person.deactivated || person.id === plugin.ownerUserId),
    )
    .sort(byDisplayName);

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 26 }}>
      <div>
        <button
          className="btn btn-ghost"
          onClick={() => navigate("/admin/apps")}
        >
          ← All apps
        </button>
      </div>

      <div>
        <h2
          style={{
            margin: "0 0 4px",
            fontSize: "var(--text-lg)",
            fontWeight: 600,
          }}
        >
          {plugin.name}
        </h2>
        <div className="pref-hint">
          {plugin.slug} · v{plugin.version} · {plugin.status}
          {plugin.aguiUrl ? " · answers over AG-UI" : ""}
        </div>
      </div>

      {plugin.lastError && (
        <div className="connection-banner">
          Last failure: {plugin.lastError}
        </div>
      )}

      <div>
        <h3 className="section-label">Endpoint</h3>
        <div className="pref-hint" style={{ wordBreak: "break-all" }}>
          {endpoint ?? "None — this app is not reachable over the network."}
        </div>
      </div>

      <div>
        <h3 className="section-label">Channels</h3>
        <div className="pref-hint" style={{ marginBottom: 10 }}>
          {joined.length === 0
            ? "This app is not in any channel yet, so nobody can reach it. Add it to one."
            : `Mentioning it in ${
                joined.length === 1 ? "this channel" : "these channels"
              } will reach it.`}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {channels.length === 0 && (
            <div className="pref-hint">
              There are no public channels to add it to.
            </div>
          )}
          {channels.map((channel) => (
            <div className="pref-row" key={channel.id}>
              <div>
                <div className="pref-label">#{channel.name ?? channel.id}</div>
              </div>
              <button
                className={channel.joined ? "btn btn-ghost" : "btn"}
                onClick={() =>
                  void act(() =>
                    channel.joined
                      ? api.admin.appLeaveChannel(pluginId, channel.id)
                      : api.admin.appJoinChannel(pluginId, channel.id),
                  )
                }
              >
                {channel.joined ? "Remove" : "Add"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="section-label">Owner</h3>
        <div className="pref-hint" style={{ marginBottom: 10 }}>
          {plugin.ownerUserId
            ? `Only ${owner?.displayName ?? "its owner"} can command this agent, plus anyone they lend it to with /allow. Mentioning it does nothing for everybody else.`
            : "Nobody owns this agent, so anyone can mention it and get an answer — which is what the assistant a workspace shares should do."}
        </div>
        <select
          className="input"
          style={{ maxWidth: 280 }}
          aria-label={`Owner of ${plugin.name}`}
          value={plugin.ownerUserId ?? ""}
          onChange={(event) =>
            void act(() =>
              api.admin.setPluginOwner(pluginId, event.target.value || null),
            )
          }
        >
          <option value="">The workspace — anyone can use it</option>
          {plugin.ownerUserId && !owner && (
            <option value={plugin.ownerUserId}>Someone no longer here</option>
          )}
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}
            </option>
          ))}
        </select>
      </div>

      <div>
        <h3 className="section-label">Permissions</h3>
        <div className="pref-hint">
          {plugin.scopes.length ? plugin.scopes.join(", ") : "None granted."}
        </div>
      </div>

      {secretNotice?.botToken && (
        <div>
          <h3 className="section-label">New credentials</h3>
          <div className="admin-secret-card">
            <div className="min-0">
              <div className="admin-row-title">{secretNotice.pluginName}</div>
              <div className="admin-row-meta">
                Shown once. Rotate again later if you lose them.
              </div>
            </div>
            {secretNotice.signingSecret && (
              <div className="draft-chip admin-secret-chip">
                <span className="admin-secret-label">Signing secret</span>
                <code>{secretNotice.signingSecret}</code>
              </div>
            )}
            <div className="draft-chip admin-secret-chip">
              <span className="admin-secret-label">Bot token</span>
              <code>{secretNotice.botToken}</code>
            </div>
          </div>
          {plugin.runtime === "socket" && (
            <>
              <JanusSetup agentName={plugin.name} botToken={secretNotice.botToken} />
              <details style={{ marginTop: 10 }}>
                <summary className="pref-hint">Not Janus? Connect another agent with the bridge</summary>
                <DesktopAgentSetup
                  agentName={plugin.name}
                  botToken={secretNotice.botToken}
                  signingSecret={secretNotice.signingSecret ?? null}
                />
              </details>
            </>
          )}
        </div>
      )}

      <div>
        <h3 className="section-label">Budget, credentials and activity</h3>
        <PluginCard
          plugin={plugin}
          expanded
          scopeCatalog={catalog?.scopes ?? {}}
          runs={runs}
          deliveries={deliveries}
          expandedDeliveryId={expandedDeliveryId}
          deliveryDetails={deliveryDetails}
          act={act}
          onError={onError}
          onSecret={setSecretNotice}
          onToggleActivity={() => undefined}
          onToggleDelivery={toggleDelivery}
          onReplay={(deliveryId) =>
            void act(async () => {
              await api.admin.replayPluginDelivery(pluginId, deliveryId);
              const response = await api.admin.pluginDeliveries(pluginId);
              setDeliveries(response.deliveries);
            })
          }
          onUninstall={() => setUninstalling(true)}
        />
      </div>

      {uninstalling && (
        <ConfirmDialog
          title={`Uninstall ${plugin.name}?`}
          body="Its tokens stop working and it stops receiving events. Messages it posted stay."
          confirmLabel="Uninstall"
          danger
          onClose={() => setUninstalling(false)}
          onConfirm={() => {
            setUninstalling(false);
            void act(async () => {
              await api.admin.uninstallPlugin(pluginId);
              navigate("/admin/apps");
            });
          }}
        />
      )}
    </section>
  );
}
