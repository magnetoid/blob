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

import { useCallback, useState } from "react";
import {
  api,
  ApiError,
  type AdminPlugin,
} from "../../../../lib/api.ts";
import { useStore } from "../../../../lib/store.ts";
import { showChannel } from "../../../../lib/navigation.ts";
import { useAdminAction, useAdminData } from "../../../console/hooks.ts";
import { AppChannelList } from "../apps/AppChannelList.tsx";
import { BudgetRow } from "../apps/BudgetRow.tsx";
import { RunLog } from "../apps/RunLog.tsx";
import { isSeededJanus } from "./seeded.ts";

/** Janus's own ceiling for `forwardedProps.instructions`, which the route enforces. */
const INSTRUCTIONS_MAX = 4000;

/**
 * The sentences a control has to be announced *with*, not merely beside.
 *
 * Both controls can be dead, and the reason is the whole point of drawing them dead
 * rather than hiding them — but a screen reader on a disabled switch read out a switch
 * that is off and dead and never the paragraph next to it. Fixed ids rather than
 * generated ones: there is one Janus on the page, so there is one of each.
 */
const EVERYWHERE_HINT = "janus-everywhere-hint";
const INSTRUCTIONS_HINT = "janus-instructions-hint";
const INSTRUCTIONS_COUNT = "janus-instructions-count";

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
      <div className="admin-row">
        <div className="grow min-0">
          <div className="admin-row-title">
            {plugin.name}
            <span className="role-pill" data-status={plugin.status}>
              {enabled ? "enabled" : plugin.status}
            </span>
          </div>
          <div className="admin-row-meta">
            {plugin.slug} · v{plugin.version}
            {plugin.aguiUrl ? " · answers over AG-UI" : ""}
            {` · ${plugin.runsLastWeek} run${plugin.runsLastWeek === 1 ? "" : "s"} this week`}
          </div>
        </div>
        <div className="admin-row-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void act(() => api.admin.setPluginEnabled(plugin.id, !enabled))}
          >
            {enabled ? "Disable" : "Enable"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={!plugin.botUserId || !enabled}
            onClick={() => void sayHello()}
          >
            Say hello
          </button>
        </div>
      </div>

      {plugin.lastError && (
        <div className="connection-banner">Last failure: {plugin.lastError}</div>
      )}

      <div>
        <h3 className="section-label">Channels</h3>
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
          <p className="pref-hint">
            {loading ? "Loading…" : "The channels it is in could not be read."}
          </p>
        )}
        <div className="pref-row">
          <div className="grow">
            <div className="pref-label">Join every public channel automatically</div>
            <div className="pref-hint" id={EVERYWHERE_HINT}>
              {seeded
                ? "Public channels founded from now on. Today's channels are the list above — turning this off never removes it from a room it is already in."
                : inertReason}
            </div>
          </div>
          <button
            type="button"
            className="toggle"
            aria-pressed={plugin.inEveryPublicChannel && seeded}
            aria-label="Join every public channel automatically"
            aria-describedby={EVERYWHERE_HINT}
            disabled={!seeded}
            onClick={() =>
              void act(() =>
                api.admin.setPluginEverywhere(plugin.id, !plugin.inEveryPublicChannel),
              )
            }
          >
            <span />
          </button>
        </div>
      </div>

      <div>
        <h3 className="section-label">Budget</h3>
        <div className="pref-hint" style={{ marginBottom: 10 }}>
          What this workspace may spend on it in a day. Reaching a cap stops the next run
          and nothing else.
        </div>
        <BudgetRow
          key={`${plugin.budgetRunsPerDay ?? "-"}:${plugin.budgetSecondsPerDay ?? "-"}`}
          plugin={plugin}
          act={act}
        />
      </div>

      <div>
        <h3 className="section-label">Instructions</h3>
        <Instructions
          key={plugin.instructions ?? ""}
          plugin={plugin}
          act={act}
          seeded={seeded}
          inertReason={inertReason}
        />
      </div>

      <div>
        <h3 className="section-label">Recent runs</h3>
        {data ? (
          <RunLog runs={data.runs} emptyLabel="Nobody here has asked Janus anything yet." />
        ) : (
          <p className="pref-hint">
            {loading ? "Loading…" : "The recent runs could not be read."}
          </p>
        )}
      </div>
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

  return (
    <>
      <div className="pref-hint" id={INSTRUCTIONS_HINT} style={{ marginBottom: 10 }}>
        {seeded
          ? "Sent with every run as a standing instruction — how to answer here, what this team calls things, what to leave alone. It is not a message: nobody in the conversation sees it, and the agent keeps no copy between runs."
          : inertReason}
      </div>
      <textarea
        className="input agentic-textarea"
        aria-label={`Instructions for ${plugin.name}`}
        // Its reason and its count: the two things somebody typing in here cannot see,
        // and the count is the one that decides whether Save will be refused.
        aria-describedby={`${INSTRUCTIONS_HINT} ${INSTRUCTIONS_COUNT}`}
        placeholder="Answer briefly. Ask before writing to anything outside this channel."
        value={text}
        disabled={!seeded}
        maxLength={INSTRUCTIONS_MAX}
        onChange={(event) => setText(event.target.value)}
      />
      <div
        className="admin-row"
        style={{ alignItems: "center", gap: 10, marginTop: 8 }}
      >
        <span className="pref-hint grow" id={INSTRUCTIONS_COUNT}>
          {text.length} / {INSTRUCTIONS_MAX}
        </span>
        <button
          type="button"
          className="btn btn-primary"
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
        </button>
      </div>
    </>
  );
}
