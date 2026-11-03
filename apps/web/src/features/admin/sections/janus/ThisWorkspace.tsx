/** Janus, as this workspace has it: on or off, where it is, what it may spend, and
 * what it has been told.
 *
 * Everything here is the workspace's own `plugins` row and the plugin routes that
 * already existed, which is what lets the half stand on its own: an admin who is not
 * this server's admin never reads `/api/admin/janus` and still gets all of it, and none
 * of it needs Janus to be answering.
 *
 * Two of the controls are the seeded agent's alone — the server refuses them for
 * anything else, and a run stops carrying stored instructions the moment the row stops
 * being that agent. They are drawn disabled with the reason rather than hidden: a
 * control that has quietly gone missing reads as a thing Blob cannot do.
 */

import { useCallback, useId, useState } from "react";
import {
  api,
  ApiError,
  type AdminPlugin,
} from "../../../../lib/api.ts";
import { useStore } from "../../../../lib/store.ts";
import { showChannel } from "../../../../lib/navigation.ts";
import { Alert, AlertDescription } from "../../../../components/ui/alert.tsx";
import { Badge } from "../../../../components/ui/badge.tsx";
import { Button } from "../../../../components/ui/button.tsx";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "../../../../components/ui/field.tsx";
import { Switch } from "../../../../components/ui/switch.tsx";
import { Textarea } from "../../../../components/ui/textarea.tsx";
import { Card, CardFields, CardNotice } from "../../../console/Card.tsx";
import { useAdminAction, useAdminData } from "../../../console/hooks.ts";
import { AppChannelList } from "../apps/AppChannelList.tsx";
import { BudgetRow } from "../apps/BudgetRow.tsx";
import { RecentErrors } from "../apps/RecentErrors.tsx";
import { RunLog } from "../apps/RunLog.tsx";
import { isSeededJanus } from "./seeded.ts";

/** Janus's own ceiling for `forwardedProps.instructions`, which the route enforces. */
const INSTRUCTIONS_MAX = 4000;

export function ThisWorkspace({
  plugin,
  onError,
  onChanged,
}: {
  plugin: AdminPlugin;
  onError: (message: string | null) => void;
  /** The row changed: the page above owns it, and reloads it. */
  onChanged: () => void;
}) {
  const load = useCallback(async () => {
    const [channels, runs] = await Promise.all([
      api.admin.appChannels(plugin.id),
      api.admin.pluginRuns(plugin.id),
    ]);
    return { channels: channels.channels, runs: runs.runs };
  }, [plugin.id]);

  const { data, loading, reload } = useAdminData(
    load,
    [plugin.id],
    onError,
    "Could not load what Janus is doing here.",
  );
  // Both, and only these two: what changed is this workspace's row and what the row is
  // doing here. `onChanged` is deliberately *not* the page's whole reload — the overview
  // beside it costs Janus five upstream calls, and a budget edit has nothing to do with
  // any of them.
  const refresh = useCallback(() => {
    reload();
    onChanged();
  }, [reload, onChanged]);
  const act = useAdminAction(onError, refresh);
  // The sentence a control has to be announced *with*, not merely beside: the switch can
  // be dead, and the reason is the whole point of drawing it dead rather than hiding it —
  // but a screen reader on a disabled switch read out a switch that is off and dead and
  // never the paragraph next to it.
  const everywhere = useId();

  const seeded = isSeededJanus(plugin);
  const enabled = plugin.status === "enabled";
  const inertReason = plugin.ownerUserId
    ? "This one belongs to someone here. A person's own agent is not the workspace's to instruct or to place — hand it back to the workspace on its app page first."
    : "Only the agent Blob seeds takes these. This row was registered by hand, so a run carries neither of them however they are set here.";

  /**
   * "Is it working?" with a button.
   *
   * A DM rather than a channel because it is one person's question, and the ordinary
   * send path rather than anything of its own because a probe that took a private route
   * would prove the private route works. The navigation is last: if the send fails, the
   * admin stays on the page that can explain why.
   */
  async function sayHello() {
    if (!plugin.botUserId) return;
    onError(null);
    try {
      const { channel } = await api.dms.open([plugin.botUserId]);
      useStore.setState((s) => ({ channels: { ...s.channels, [channel.id]: channel } }));
      await useStore.getState().sendMessage(channel.id, "hello", null, [], false);
      await showChannel(channel.id);
    } catch (err) {
      onError(
        err instanceof ApiError ? err.message : "Could not start that conversation.",
      );
    }
  }

  return (
    <>
      <Card
        title={
          <>
            {plugin.name}
            <Badge
              variant={
                enabled ? "secondary" : plugin.status === "failed" ? "destructive" : "outline"
              }
            >
              {plugin.status.replace("_", " ")}
            </Badge>
          </>
        }
        description={
          <>
            {plugin.slug} · v{plugin.version}
            {plugin.aguiUrl ? " · answers over AG-UI" : ""}
            {` · ${plugin.runsLastWeek} run${plugin.runsLastWeek === 1 ? "" : "s"} this week`}
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => void act(() => api.admin.setPluginEnabled(plugin.id, !enabled))}
            >
              {enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              variant="outline"
              disabled={!plugin.botUserId || !enabled}
              onClick={() => void sayHello()}
            >
              Say hello
            </Button>
          </>
        }
      >
        {plugin.lastError && (
          // Polite: it is where the agent stood when the page opened, not news.
          <Alert variant="destructive" role="status">
            <AlertDescription className="wrap-anywhere">
              Last failure: {plugin.lastError}
            </AlertDescription>
          </Alert>
        )}
        <RecentErrors errors={plugin.recentErrors} />
      </Card>

      <Card title="Channels">
        {/* Not before the answer is in. "Janus is not in any channel yet, so nobody can
            reach it" is a diagnosis, and for the first moment of every visit it was one
            the page had no evidence for. */}
        {data ? (
          <AppChannelList
            pluginId={plugin.id}
            channels={data.channels}
            act={act}
            subject={plugin.name}
          />
        ) : (
          <CardNotice>
            {loading ? "Loading…" : "The channels it is in could not be read."}
          </CardNotice>
        )}
        <CardFields>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor={`${everywhere}-switch`}>
                Join every public channel automatically
              </FieldLabel>
              <FieldDescription id={`${everywhere}-hint`}>
                {seeded
                  ? "Public channels founded from now on. Today's channels are the list above — turning this off never removes it from a room it is already in."
                  : inertReason}
              </FieldDescription>
            </FieldContent>
            <Switch
              id={`${everywhere}-switch`}
              aria-describedby={`${everywhere}-hint`}
              checked={plugin.inEveryPublicChannel && seeded}
              disabled={!seeded}
              onCheckedChange={(on) =>
                void act(() => api.admin.setPluginEverywhere(plugin.id, on))
              }
            />
          </Field>
        </CardFields>
      </Card>

      <Card
        title="Budget"
        description="What this workspace may spend on it in a day. Reaching a cap stops the next run and nothing else."
      >
        <BudgetRow
          key={`${plugin.budgetRunsPerDay ?? "-"}:${plugin.budgetSecondsPerDay ?? "-"}`}
          plugin={plugin}
          act={act}
        />
      </Card>

      <Instructions
        key={plugin.instructions ?? ""}
        plugin={plugin}
        act={act}
        seeded={seeded}
        inertReason={inertReason}
      />

      <Card title="Recent runs">
        {!data ? (
          <CardNotice>
            {loading ? "Loading…" : "The recent runs could not be read."}
          </CardNotice>
        ) : (
          <RunLog
            pluginId={plugin.id}
            runs={data.runs}
            emptyLabel="Nobody here has asked Janus anything yet."
          />
        )}
      </Card>
    </>
  );
}

/**
 * What this workspace tells its agent, sent with every run.
 *
 * Keyed by its caller on the saved text, so a save that comes back from the reload
 * reseeds the box instead of fighting it — the same reason `BudgetRow` is keyed.
 *
 * The count is of what is typed and the ceiling is the server's, which measures after
 * trimming: a box at the limit can therefore always be saved, which is the direction
 * the two may safely disagree in.
 */
function Instructions({
  plugin,
  act,
  seeded,
  inertReason,
}: {
  plugin: AdminPlugin;
  act: (run: () => Promise<unknown>) => Promise<void>;
  seeded: boolean;
  inertReason: string;
}) {
  const saved = plugin.instructions ?? "";
  const [text, setText] = useState(saved);
  const trimmed = text.trim();
  const ids = useId();

  // Its own card, so the count and the Save share the card's footer: the count is what
  // decides whether Save will be refused, and it now sits beside it. The card's title is
  // the box's label, so a click on it puts the cursor there; and its description — what it
  // is, or why it is dead — is read with the box, with the count, the other thing
  // somebody typing in it cannot see.
  return (
    <Card
      title={<label htmlFor={`${ids}-box`}>Instructions</label>}
      description={
        seeded
          ? "Sent with every run as a standing instruction — how to answer here, what this team calls things, what to leave alone. It is not a message: nobody in the conversation sees it, and the agent keeps no copy between runs."
          : inertReason
      }
      descriptionId={`${ids}-hint`}
      footer={
        <>
          <span id={`${ids}-count`} className="text-sm text-muted-foreground">
            {text.length} / {INSTRUCTIONS_MAX}
          </span>
          <Button
            disabled={!seeded || trimmed === saved}
            onClick={() =>
              // Empty means "nothing to say", sent as an explicit null rather than "" so
              // the wire says the same thing the screen does.
              void act(() =>
                api.admin.setPluginInstructions(plugin.id, trimmed === "" ? null : trimmed),
              )
            }
          >
            Save instructions
          </Button>
        </>
      }
    >
      <Textarea
        id={`${ids}-box`}
        className="min-h-23 resize-y"
        aria-describedby={`${ids}-hint ${ids}-count`}
        placeholder="Answer briefly. Ask before writing to anything outside this channel."
        value={text}
        disabled={!seeded}
        maxLength={INSTRUCTIONS_MAX}
        onChange={(event) => setText(event.target.value)}
      />
    </Card>
  );
}
