/** One app's settings.
 *
 * The list answers "what is installed"; this answers "why is it not doing anything",
 * which until now had no screen at all. The load-bearing part is the channel list: an
 * installed app is inert until its bot is a member somewhere, and an app that answers
 * over AG-UI never calls Blob on its own, so it cannot join for itself the way a webhook
 * app can. Before this, installing an agent produced something that looked installed and
 * spoke nowhere, with nothing on screen to say why.
 */

import { useCallback, useEffect, useId, useState } from "react";
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
import { DialogPresence } from "../../../components/Dialog.tsx";
import { showError } from "../../../lib/toasts.ts";
import { ChevronLeftIcon } from "../../../components/Icon.tsx";
import { Alert, AlertDescription } from "../../../components/ui/alert.tsx";
import { Button } from "../../../components/ui/button.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "../../../components/ui/field.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import { Switch } from "../../../components/ui/switch.tsx";
import { Card, CardFields, CardNotice, LegacyRows } from "../../console/Card.tsx";
import { CopyField } from "../../console/CopyField.tsx";
import { AppChannelList } from "./apps/AppChannelList.tsx";
import { AgentFollows } from "./apps/AgentFollows.tsx";
import { AgentMcpServers } from "./apps/AgentMcpServers.tsx";
import { PluginCard } from "./apps/PluginCard.tsx";
import { RecentErrors } from "./apps/RecentErrors.tsx";
import { useDisclosure } from "./apps/useDisclosure.ts";
import { JanusSetup } from "../../agentic/JanusSetup.tsx";
import { DesktopAgentSetup } from "../../agentic/DesktopAgentSetup.tsx";
import { MemoryList } from "../../agentic/MemoryList.tsx";
import { NoteList } from "../../agentic/NoteList.tsx";

interface Props {
  pluginId: string;
  onError: (message: string | null) => void;
}

export function AppSettings({ pluginId, onError }: Props) {
  const [plugin, setPlugin] = useState<AdminPlugin | null>(null);
  const [channels, setChannels] = useState<AppChannel[]>([]);
  const [catalog, setCatalog] = useState<AdminPluginCatalog | null>(null);
  const users = useStore((s) => s.users);
  const ids = useId();

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

  if (loading && !plugin) return <NoApp>Loading…</NoApp>;
  if (!plugin) return <NoApp>That app is not installed here.</NoApp>;

  const endpoint = plugin.aguiUrl ?? plugin.requestUrl;
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
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        className="self-start"
        onClick={() => navigate("/admin/apps")}
      >
        <ChevronLeftIcon size="sm" />
        All apps
      </Button>

      {/* What it is, where it points, whose it is and what it may do: the four answers
          that were four headings down the page, as rows of the app's own card. */}
      <Card
        title={plugin.name}
        description={
          <>
            {plugin.slug} · v{plugin.version} · {plugin.status}
            {plugin.aguiUrl ? " · answers over AG-UI" : ""}
            {plugin.aguiVersion ? ` ${plugin.aguiVersion}` : ""}
          </>
        }
      >
        {plugin.lastError && (
          <Alert variant="destructive">
            <AlertDescription>Last failure: {plugin.lastError}</AlertDescription>
          </Alert>
        )}
        <RecentErrors errors={plugin.recentErrors} />

        <CardFields>
          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>Endpoint</FieldTitle>
              <FieldDescription className="wrap-anywhere">
                {endpoint ?? "None — this app is not reachable over the network."}
              </FieldDescription>
            </FieldContent>
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor={`${ids}-owner`}>Owner</FieldLabel>
              <FieldDescription id={`${ids}-owner-hint`}>
                {plugin.ownerUserId
                  ? `Only ${owner?.displayName ?? "its owner"} can command this agent, plus anyone they lend it to with /allow. Mentioning it does nothing for everybody else.`
                  : "Nobody owns this agent, so anyone can mention it and get an answer — which is what the assistant a workspace shares should do."}
              </FieldDescription>
            </FieldContent>
            <NativeSelect
              id={`${ids}-owner`}
              aria-describedby={`${ids}-owner-hint`}
              value={plugin.ownerUserId ?? ""}
              onChange={(event) =>
                void act(() =>
                  api.admin.setPluginOwner(pluginId, event.target.value || null),
                )
              }
            >
              <NativeSelectOption value="">
                The workspace — anyone can use it
              </NativeSelectOption>
              {plugin.ownerUserId && !owner && (
                <NativeSelectOption value={plugin.ownerUserId}>
                  Someone no longer here
                </NativeSelectOption>
              )}
              {people.map((person) => (
                <NativeSelectOption key={person.id} value={person.id}>
                  {person.displayName}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldTitle>Permissions</FieldTitle>
              <FieldDescription>
                {plugin.scopes.length ? plugin.scopes.join(", ") : "None granted."}
              </FieldDescription>
            </FieldContent>
          </Field>

          {(plugin.aguiUrl || plugin.runtime === "socket") && (
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor={`${ids}-tools`}>
                  What it may do in the workspace
                </FieldLabel>
                <FieldDescription id={`${ids}-tools-hint`}>
                  With Blob&apos;s tools, an agent can look further than the conversation it
                  was asked in — always as the person who asked, and in a channel only
                  into public channels and that room. Posts wait for that person&apos;s
                  approval unless you choose otherwise below.
                </FieldDescription>
              </FieldContent>
              <NativeSelect
                id={`${ids}-tools`}
                aria-describedby={`${ids}-tools-hint`}
                value={plugin.toolAccess ?? "none"}
                onChange={(event) =>
                  void act(() =>
                    api.admin.setPluginTools(
                      pluginId,
                      event.target.value as AdminPlugin["toolAccess"],
                    ),
                  )
                }
              >
                <NativeSelectOption value="none">Only answer what it was asked</NativeSelectOption>
                <NativeSelectOption value="read">
                  Read and search, as the person who asked
                </NativeSelectOption>
                <NativeSelectOption value="write">Read, and post as itself</NativeSelectOption>
              </NativeSelect>
            </Field>
          )}

          {(plugin.aguiUrl || plugin.runtime === "socket") && plugin.toolAccess === "write" && (
            <Field orientation="responsive">
              <FieldContent>
                <FieldLabel htmlFor={`${ids}-posts`}>When it posts</FieldLabel>
                <FieldDescription id={`${ids}-posts-hint`}>
                  Asked in its own DM, the only words that reach it are that person&apos;s. In a
                  channel, anyone&apos;s message can try to steer it — so asking first is the
                  safe default there. Either way it can only post where that person and the
                  agent both can, and from a channel only to that room or a public one.
                </FieldDescription>
              </FieldContent>
              <NativeSelect
                id={`${ids}-posts`}
                aria-describedby={`${ids}-posts-hint`}
                value={plugin.writeApproval ?? "ask"}
                onChange={(event) =>
                  void act(() =>
                    api.admin.setPluginTools(
                      pluginId,
                      "write",
                      event.target.value as AdminPlugin["writeApproval"],
                    ),
                  )
                }
              >
                <NativeSelectOption value="ask">Ask the person every time</NativeSelectOption>
                <NativeSelectOption value="auto_in_dm">
                  Without asking in its DM with them; ask elsewhere
                </NativeSelectOption>
                <NativeSelectOption value="auto_everywhere">Without asking, anywhere</NativeSelectOption>
              </NativeSelect>
            </Field>
          )}

          {(plugin.aguiUrl || plugin.runtime === "socket") && (
            <AgentMcpServers pluginId={pluginId} agentName={plugin.name} />
          )}

          {(plugin.aguiUrl || plugin.runtime === "socket") && (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor={`${ids}-reasoning`}>Show its reasoning</FieldLabel>
                <FieldDescription id={`${ids}-reasoning-hint`}>
                  The card under a mention can show the channel a tail of what the agent
                  was thinking. Off by default: an agent narrates what it read there,
                  including from tools and memory of its own beyond the room.
                </FieldDescription>
              </FieldContent>
              <Switch
                id={`${ids}-reasoning`}
                aria-describedby={`${ids}-reasoning-hint`}
                checked={plugin.showsReasoning}
                onCheckedChange={(on) =>
                  void act(() => api.admin.setPluginReasoning(pluginId, on))
                }
              />
            </Field>
          )}
        </CardFields>
      </Card>

      <Card title="Channels">
        <AppChannelList pluginId={pluginId} channels={channels} act={act} />
      </Card>

      {(plugin.aguiUrl || plugin.runtime === "socket") && (
        <Card title="Channels it follows">
          <AgentFollows
            pluginId={pluginId}
            agentName={plugin.name}
            channels={channels}
            act={act}
          />
        </Card>
      )}

      {/* A rotated signing secret and an issued token are each shown once, here, and not
          again: the server keeps only their hashes. */}
      {(secretNotice?.signingSecret || secretNotice?.botToken) && (
        <Card
          title={`New credentials for ${secretNotice.pluginName}`}
          description="Shown once. Rotate again later if you lose them."
        >
          {secretNotice.signingSecret && (
            <CopyField label="Signing secret" value={secretNotice.signingSecret} />
          )}
          {secretNotice.botToken && (
            <CopyField label="Bot token" value={secretNotice.botToken} />
          )}
        </Card>
      )}
      {secretNotice?.botToken && plugin.runtime === "socket" && (
        <>
          {/* What these two print is the agents console's own markup (`features/agentic/`),
              drawn by the legacy stylesheet. */}
          <div data-legacy>
            <JanusSetup agentName={plugin.name} botToken={secretNotice.botToken} />
          </div>
          <BridgeInstead
            agentName={plugin.name}
            botToken={secretNotice.botToken}
            signingSecret={secretNotice.signingSecret ?? null}
          />
        </>
      )}

      <Card title="Budget, credentials and activity">
        <PluginCard
          plugin={plugin}
          scopeCatalog={catalog?.scopes ?? {}}
          runs={runs}
          deliveries={deliveries}
          expandedDeliveryId={expandedDeliveryId}
          deliveryDetails={deliveryDetails}
          act={act}
          onError={onError}
          onSecret={setSecretNotice}
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
      </Card>

      <AgentMemoryCard pluginId={pluginId} onError={onError} />
      <AgentNotesCard pluginId={pluginId} onError={onError} />

      <DialogPresence when={uninstalling}>
        {() => (
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
      </DialogPresence>
    </div>
  );
}

/** For a token that was issued to an agent that is not Janus: the bridge, folded under the
 * Janus steps above it. */
function BridgeInstead({
  agentName,
  botToken,
  signingSecret,
}: {
  agentName: string;
  botToken: string;
  signingSecret: string | null;
}) {
  const disclosure = useDisclosure();
  return (
    <div className="flex flex-col items-start gap-3">
      <Button variant="ghost" size="sm" {...disclosure.buttonProps}>
        Not Janus? Connect another agent with the bridge
      </Button>
      {disclosure.open && (
        <div id={disclosure.panelId} data-legacy className="w-full">
          <DesktopAgentSetup
            agentName={agentName}
            botToken={botToken}
            signingSecret={signingSecret}
          />
        </div>
      )}
    </div>
  );
}

/**
 * What this agent remembers of conversations you can see — the memories nobody owns
 * (migration 0050). Forget one and the agent starts that conversation fresh; forget them
 * all and it reaches rooms you are not in as well, which reveals nothing of them. A
 * person's own memory with an agent they own or borrow is theirs, in their Settings, and
 * never shown here.
 */
/** What this agent noted of conversations you can see (M2 · A8) — words, so they can be
 *  corrected as well as forgotten. A person's own notes with it are theirs, in Settings. */
function AgentNotesCard({
  pluginId,
  onError,
}: {
  pluginId: string;
  onError: (message: string | null) => void;
}) {
  const { data, reload } = useAdminData(
    () => api.admin.agentNotes(pluginId),
    [pluginId],
    onError,
    "Could not load the notes it kept.",
  );
  const act = useAdminAction(onError, reload);
  const notes = data?.notes ?? [];
  return (
    <Card title="Notes it kept">
      {data && notes.length === 0 && (
        <CardNotice>None, in the conversations you can see.</CardNotice>
      )}
      {notes.length > 0 && (
        <LegacyRows>
          <NoteList
            notes={notes}
            showAgent={false}
            onReword={(note, body) => act(() => api.admin.rewordAgentNote(pluginId, note.id, body))}
            onForget={(note) => void act(() => api.admin.forgetAgentNote(pluginId, note.id))}
          />
        </LegacyRows>
      )}
    </Card>
  );
}

function AgentMemoryCard({
  pluginId,
  onError,
}: {
  pluginId: string;
  onError: (message: string | null) => void;
}) {
  const { data, reload } = useAdminData(
    () => api.admin.agentMemory(pluginId),
    [pluginId],
    onError,
    "Could not load what it remembers.",
  );
  const act = useAdminAction(onError, reload);
  const [confirming, setConfirming] = useState(false);
  const memories = data?.memories ?? [];

  return (
    <Card
      title="What it remembers"
      // The way to forget all of it closes the card, whether or not any is listed: it also
      // reaches the conversations that are not shown here.
      footer={
        data ? (
          confirming ? (
            <>
              <Button
                variant="destructive"
                onClick={() =>
                  void act(async () => {
                    await api.admin.forgetAllAgentMemory(pluginId);
                    setConfirming(false);
                  })
                }
              >
                Forget every conversation
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              Forget everything it remembers of conversations
            </Button>
          )
        ) : undefined
      }
    >
      {data && memories.length === 0 && (
        <CardNotice>Nothing, in the conversations you can see.</CardNotice>
      )}
      {memories.length > 0 && (
        <LegacyRows>
          <MemoryList
            memories={memories}
            showAgent={false}
            onForget={(memory) =>
              void act(() => api.admin.forgetAgentMemory(pluginId, memory.id))
            }
          />
        </LegacyRows>
      )}
    </Card>
  );
}

/** Where the app page would be, while it loads or when the id names nothing here. */
function NoApp({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardNotice>{children}</CardNotice>
      </Card>
    </div>
  );
}
