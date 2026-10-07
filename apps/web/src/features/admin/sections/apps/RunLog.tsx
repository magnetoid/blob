/** What an agent has been asked lately, and how each attempt ended.
 *
 * Shared by the app page and the Janus page, which ask the same question of the same
 * route. `emptyLabel` is the only thing they differ on: "this app" is wrong on a page
 * about one named agent.
 */

import { type AdminAgentRun } from "../../../../lib/api.ts";
import { formatTokens } from "../../../../lib/format.ts";
import { formatRelative } from "../../../messages/messageFormatting.ts";
import { RunWork, SeenLine } from "../../../messages/AgentRunCard.tsx";
import { CardNotice } from "../../../console/Card.tsx";

export function RunLog({
  runs,
  emptyLabel = "This app has not been asked anything yet.",
}: {
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
          </div>
        </div>
      ))}
    </>
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
