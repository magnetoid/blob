/** What an agent has been asked lately, and how each attempt ended.
 *
 * Shared by the app page and the Janus page, which ask the same question of the same
 * route. `emptyLabel` is the only thing they differ on: "this app" is wrong on a page
 * about one named agent.
 */

import { type AdminAgentRun } from "../../../../lib/api.ts";
import { formatRelative } from "../../../messages/messageFormatting.ts";
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
            <div className="admin-row-title">
              {run.channelName ? `#${run.channelName}` : "a channel"}
              {/* Not muted for `interrupted`: the agent is waiting for a person, which
                  is the one outcome somebody can act on, and greying it would read as
                  "nothing to do". */}
              <span
                className="role-pill"
                data-muted={run.status !== "succeeded" && run.status !== "interrupted"}
              >
                {run.status}
              </span>
            </div>
            <div className="admin-row-meta">
              {run.triggerUserName ?? "someone"} asked · {formatRelative(run.startedAt)}
              {run.durationMs !== null && ` · ${run.durationMs} ms`}
              {` · ${run.postCount} ${run.postCount === 1 ? "reply" : "replies"}`}
              {run.transport === "socket" && " · over its own socket"}
              {run.error && ` · ${run.error}`}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
