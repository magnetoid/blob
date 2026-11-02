/** One installed app: what it is, what an update asks for, its budget, its credentials
 * and the buttons that act on it, and what has happened to it lately.
 *
 * Drawn as the contents of a card of the page that holds it — it adds no frame of its own —
 * so its parts take the card's gap, and its two lists of activity run to the card's edges.
 */

import { useId } from "react";
import {
  api,
  ApiError,
  type AdminPlugin,
  type AdminAgentRun,
  type AdminPluginDelivery,
  type AdminPluginDeliveryDetail,
} from "../../../../lib/api.ts";
import { useStore } from "../../../../lib/store.ts";
import { Alert, AlertDescription, AlertTitle } from "../../../../components/ui/alert.tsx";
import { Badge } from "../../../../components/ui/badge.tsx";
import { Button } from "../../../../components/ui/button.tsx";
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "../../../../components/ui/item.tsx";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { CardHeading, CardNotice, CardRow, CardRows } from "../../../console/Card.tsx";
import { AgentDeployment } from './AgentDeployment.tsx';
import { BudgetRow } from './BudgetRow.tsx';
import { RunLog } from './RunLog.tsx';

/** What a row opens onto: a bordered, tinted panel across the row's full width. */
const PANEL = "flex basis-full flex-col gap-2 rounded-lg border bg-muted/50 p-3";

export function PluginCard({
  plugin,
  runs,
  deliveries,
  expandedDeliveryId,
  deliveryDetails,
  scopeCatalog,
  act,
  onError,
  onSecret,
  onToggleDelivery,
  onReplay,
  onUninstall,
}: {
  plugin: AdminPlugin;
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
  onToggleDelivery: (deliveryId: string) => void;
  onReplay: (deliveryId: string) => void;
  onUninstall: () => void;
}) {
  const enabled = plugin.status === "enabled";
  const consentId = useId();
  const owner = useStore((state) =>
    plugin.ownerUserId ? state.users[plugin.ownerUserId] : undefined,
  );
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{plugin.name}</span>
          <Badge
            variant={
              enabled
                ? "secondary"
                : plugin.status === "failed"
                  ? "destructive"
                  : "outline"
            }
          >
            {plugin.status.replace("_", " ")}
          </Badge>
          <Badge variant="outline">v{plugin.version}</Badge>
        </div>
        <p className="m-0 text-sm text-muted-foreground wrap-anywhere">
          {plugin.description || plugin.slug}
          {(plugin.aguiUrl || plugin.requestUrl) &&
            ` · ${plugin.aguiUrl ?? plugin.requestUrl}`}
          {plugin.botUserId && ` · bot user ${plugin.botUserId}`}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {/* Only ever shown for an agent that dials in, where it is the
              difference between "set up wrong" and "the laptop is asleep".
              Until this existed the only way to find out was to mention the
              agent and see whether anything came back. */}
          {plugin.online !== null && plugin.online !== undefined && (
            <Badge
              variant={plugin.online ? "secondary" : "outline"}
              title={
                plugin.online
                  ? "Holding a connection to Blob"
                  : "Not connected — start the bridge next to the agent"
              }
            >
              {plugin.online ? "connected" : "not connected"}
            </Badge>
          )}
          {/* Whose it is, where the list is scanned rather than read: an owned agent
              answers one person, and that is the difference between "quiet" and
              "not yours". Absent for the workspace's own, which is most of them. */}
          {plugin.ownerUserId && (
            <Badge
              variant="outline"
              title="Only its owner, and whoever they lend it to, can command this agent"
            >
              {owner ? `${owner.displayName}’s` : "personal"}
            </Badge>
          )}
          {plugin.events.map((eventName) => (
            <Badge variant="outline" key={eventName}>
              {eventName}
            </Badge>
          ))}
          {plugin.scopes.map((scope) => {
            const pending = plugin.pendingScopes.includes(scope);
            return (
              <Badge
                variant="outline"
                key={scope}
                // A scope an update requested that nobody has approved yet.
                className={pending ? "border-dashed text-muted-foreground" : undefined}
                title={
                  pending
                    ? "Requested by an update, not yet approved"
                    : (scopeCatalog[scope] ?? undefined)
                }
              >
                {scope}
              </Badge>
            );
          })}
          {plugin.pendingDeliveries > 0 && (
            <Badge variant="outline">{plugin.pendingDeliveries} pending</Badge>
          )}
          {plugin.failedDeliveries > 0 && (
            <Badge variant="destructive">{plugin.failedDeliveries} failed</Badge>
          )}
        </div>
      </div>

      {/* The consent screen: which permissions the update added, in words, with
          both answers available. Approving blind was the old shape — a "needs
          review" pill and an Approve button, with the diff only in the audit log.
          Declining is not disabling: the app keeps running on what it had. */}
      {plugin.status === "needs_review" && plugin.pendingScopes.length > 0 && (
        <Alert
          role="group"
          aria-labelledby={consentId}
          className="border-l-4 border-l-destructive"
        >
          <AlertTitle id={consentId}>This update asks for new permissions</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 text-foreground">
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
              {plugin.pendingScopes.map((scope) => (
                <li key={scope}>
                  <code>{scope}</code>
                  {scopeCatalog[scope] && ` — ${scopeCatalog[scope]}`}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void act(() => api.admin.approvePlugin(plugin.id))}>
                Approve new permissions
              </Button>
              <Button
                variant="outline"
                title="The app stays enabled with the permissions it already had"
                onClick={() => void act(() => api.admin.declinePluginScopes(plugin.id))}
              >
                Keep current permissions
              </Button>
            </div>
          </AlertDescription>
        </Alert>
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

      {/* What an admin wants to know before pressing Rotate or Revoke below. */}
      <p className="m-0 text-sm text-muted-foreground">
        Signing secret rotated{" "}
        {plugin.secretRotatedAt ? formatRelative(plugin.secretRotatedAt) : "never"}
        {" · "}
        {plugin.tokenLastUsedAt
          ? `a bot token last used ${formatRelative(plugin.tokenLastUsedAt)}`
          : "no bot token used yet"}
      </p>

      {plugin.lastError && (
        <p className="m-0 text-sm text-destructive wrap-anywhere">{plugin.lastError}</p>
      )}

      <div className="flex flex-wrap gap-2">
        {/* Only when parked with nothing itemised — rows from before pending scopes
            were recorded. Otherwise the consent block above holds both buttons. */}
        {plugin.status === "needs_review" && plugin.pendingScopes.length === 0 && (
          <Button onClick={() => void act(() => api.admin.approvePlugin(plugin.id))}>
            Approve
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => void act(() => api.admin.setPluginEnabled(plugin.id, !enabled))}
        >
          {enabled ? "Disable" : "Enable"}
        </Button>
        <Button
          variant="ghost"
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
        </Button>
        <Button
          variant="ghost"
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
        </Button>
        <Button
          variant="ghost"
          onClick={() => void act(() => api.admin.revokePluginTokens(plugin.id))}
        >
          Revoke tokens
        </Button>
        <Button variant="destructive" onClick={onUninstall}>
          Uninstall
        </Button>
      </div>

      {/* Headings of the card this is drawn in, a level under its title: they were
          h5s, which left the page two levels short between that title and these. */}
      <CardHeading>Recent runs</CardHeading>
      <RunLog pluginId={plugin.id} runs={runs} />

      <CardHeading>Deliveries</CardHeading>
      {deliveries.length > 0 ? (
        <CardRows>
          {deliveries.map((delivery) => (
            <DeliveryRow
              key={delivery.id}
              delivery={delivery}
              open={expandedDeliveryId === delivery.id}
              detail={deliveryDetails[delivery.id]}
              onToggle={() => onToggleDelivery(delivery.id)}
              onReplay={() => onReplay(delivery.id)}
            />
          ))}
        </CardRows>
      ) : (
        <CardNotice>No delivery attempts recorded yet.</CardNotice>
      )}
    </>
  );
}

/** One attempt to tell the app something, and — opened — what it was told. */
function DeliveryRow({
  delivery,
  open,
  detail,
  onToggle,
  onReplay,
}: {
  delivery: AdminPluginDelivery;
  open: boolean;
  detail: AdminPluginDeliveryDetail | undefined;
  onToggle: () => void;
  onReplay: () => void;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelId = `${id}-panel`;
  return (
    <CardRow>
      <ItemContent>
        <ItemTitle>
          <span id={titleId}>{delivery.event}</span>
          <Badge variant={delivery.status === "delivered" ? "secondary" : "outline"}>
            {delivery.status}
          </Badge>
        </ItemTitle>
        <ItemDescription>
          {delivery.attempts} attempts · created {formatRelative(delivery.createdAt)}
          {delivery.deliveredAt && ` · delivered ${formatRelative(delivery.deliveredAt)}`}
          {delivery.lastStatusCode && ` · HTTP ${delivery.lastStatusCode}`}
          {delivery.lastError && ` · ${delivery.lastError}`}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        {/* One word, kept: `aria-expanded` says whether it is open. Named by the delivery
            as well, since every row has one. */}
        <Button
          id={`${id}-toggle`}
          variant="outline"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-labelledby={`${id}-toggle ${titleId}`}
          onClick={onToggle}
        >
          Details
        </Button>
      </ItemActions>

      {open && (
        <div id={panelId} className={PANEL}>
          {detail ? (
            <>
              <p className="m-0 text-sm text-muted-foreground">
                {detail.attempts} attempts
                {detail.lastError && ` · ${detail.lastError}`}
                {detail.nextAttemptAt &&
                  ` · next attempt ${formatRelative(detail.nextAttemptAt)}`}
              </p>
              {(delivery.status === "failed" || delivery.status === "dead") && (
                <Button variant="outline" className="self-start" onClick={onReplay}>
                  Replay
                </Button>
              )}
              {detail.hidden || detail.payload === null ? (
                <p className="m-0 text-sm text-muted-foreground">
                  From a conversation you are not in, so what the app was sent stays
                  there.
                </p>
              ) : (
                <pre className="m-0 max-h-80 overflow-auto rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">
                  {JSON.stringify(detail.payload, null, 2)}
                </pre>
              )}
            </>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">Loading delivery…</p>
          )}
        </div>
      )}
    </CardRow>
  );
}
