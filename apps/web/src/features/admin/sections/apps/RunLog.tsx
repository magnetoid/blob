/** What an agent has been asked lately, and how each attempt ended.
 *
 * Shared by the app page and the Janus page, which ask the same question of the same
 * route. `emptyLabel` is the only thing they differ on: "this app" is wrong on a page
 * about one named agent.
 */

import { useState } from "react";
import {
  api,
  type AdminAgentRun,
  type AdminRunEvent,
} from "../../../../lib/api.ts";
import { formatTokens } from "../../../../lib/format.ts";
import { useFetch } from "../../../../lib/useFetch.ts";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { RunWork, SeenLine } from "../../../messages/AgentRunCard.tsx";
import { CardNotice } from "../../../console/Card.tsx";

export function RunLog({
  pluginId,
  runs,
  emptyLabel = "This app has not been asked anything yet.",
}: {
  pluginId: string;
  runs: AdminAgentRun[];
  emptyLabel?: string;
}) {
  if (runs.length === 0) return <CardNotice>{emptyLabel}</CardNotice>;
  return (
    <>
      {runs.map((run) => (
        <div className="admin-row" key={run.id}>
          <div className="grow min-0">
            <RunSummary run={run} />
            {/* Opening one run: what it did and what it was shown — the plan, the tool
                calls with their arguments and results, the messages and tools it had. */}
            {(run.card || run.seen) && (
              <details className="run-log-detail">
                <summary>What it did</summary>
                {run.card && <RunWork card={run.card} />}
                {run.seen && <SeenLine seen={run.seen} />}
              </details>
            )}
            {/* And what the agent actually sent, for when the two above do not say why
                a run went the way it did. Fetched only when opened: it is two hundred
                events, and the log lists thirty runs. */}
            <StreamedDetail pluginId={pluginId} runId={run.id} />
          </div>
        </div>
      ))}
    </>
  );
}

function StreamedDetail({
  pluginId,
  runId,
}: {
  pluginId: string;
  runId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="run-log-detail"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>What it streamed</summary>
      {open && <RunEvents pluginId={pluginId} runId={runId} />}
    </details>
  );
}

function RunEvents({ pluginId, runId }: { pluginId: string; runId: string }) {
  const { data, error } = useFetch(
    () => api.admin.runEvents(pluginId, runId),
    [pluginId, runId],
  );
  if (error) return <p className="pref-hint">Its events could not be read.</p>;
  if (!data) return <p className="pref-hint">Loading…</p>;
  if (data.hidden) {
    return (
      <p className="pref-hint">
        It ran in a conversation you are not in, so what it streamed is kept from
        you.
      </p>
    );
  }
  if (data.events.length === 0) {
    return (
      <p className="pref-hint">
        Nothing is kept for this run: it streamed nothing, ran before events were kept,
        or was over a week ago.
      </p>
    );
  }
  const rounds = data.events.some((entry) => entry.round > 0);
  return (
    <>
      <p className="pref-hint">
        {data.total > data.events.length
          ? `The last ${data.events.length} of ${data.total} events`
          : `${data.total} ${data.total === 1 ? "event" : "events"}`}
        , kept until {new Date(data.keptUntil).toLocaleDateString()}.
      </p>
      <ol className="run-events">
        {data.events.map((entry, index) => (
          <RunEventLine key={index} entry={entry} rounds={rounds} />
        ))}
      </ol>
    </>
  );
}

function RunEventLine({
  entry,
  rounds,
}: {
  entry: AdminRunEvent;
  rounds: boolean;
}) {
  const { type, ...rest } = entry.event;
  const detail = Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";
  return (
    <li className="run-event">
      <span className="run-event-at">
        +{entry.ms} ms{rounds ? ` · round ${entry.round + 1}` : ""}
      </span>
      <span className="run-event-type">{type ?? "(no type)"}</span>
      {detail && <code className="run-event-detail">{detail}</code>}
    </li>
  );
}

function RunSummary({ run }: { run: AdminAgentRun }) {
  return (
    <>
      <div className="admin-row-title">
        {run.channelName ? `#${run.channelName}` : "a channel"}
        {/* Not muted for `interrupted`: the agent is waiting for a person, which is
            the one outcome somebody can act on, and greying it would read as
            "nothing to do". */}
        <span
          className="role-pill"
          data-muted={
            run.status !== "succeeded" && run.status !== "interrupted"
          }
        >
          {run.status}
        </span>
      </div>
      <div className="admin-row-meta">
        {run.triggerUserName ?? "someone"} asked ·{" "}
        {formatRelative(run.startedAt)}
        {run.durationMs !== null && ` · ${run.durationMs} ms`}
        {` · ${run.postCount} ${run.postCount === 1 ? "reply" : "replies"}`}
        {run.tokens !== null && ` · ${formatTokens(run.tokens)}`}
        {run.transport === "socket" && " · over its own socket"}
        {run.error && ` · ${run.error}`}
      </div>
    </>
  );
}
