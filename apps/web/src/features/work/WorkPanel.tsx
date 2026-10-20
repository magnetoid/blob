/** The tabs beside a work channel's conversation: Plan, Changes, Preview.
 *
 * Slack Code's shape, and the reason for it: an agent building something produces a plan,
 * diffs and a running page, and a channel shows all three as a scroll of messages. The
 * conversation stays the conversation; these are the other views of the same work.
 *
 * Plan is what the agents are doing right now — the run cards for this channel, newest
 * first — plus the work's own state and the button that finishes it. Changes is every diff
 * published, with a viewer. Preview is every page and document, each run on request.
 */

import { useState } from "react";
import type { AgentRunView, Work, WorkArtifact } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { useRun, useRunIds } from "../../lib/useRuns.ts";
import { showError } from "../../lib/toasts.ts";
import { AgentRunCard } from "../messages/AgentRunCard.tsx";
import { groupArtifacts } from "./artifacts.ts";
import { ArtifactsTab } from "./ArtifactsTab.tsx";

export type WorkTab = "conversation" | "plan" | "changes" | "preview";

export function WorkTabs({
  tab,
  onChange,
  work,
  artifacts,
}: {
  tab: WorkTab;
  onChange: (tab: WorkTab) => void;
  work: Work | null;
  artifacts: WorkArtifact[];
}) {
  // Artifacts, not versions: a change published three times is one thing to look at.
  const changes = groupArtifacts(artifacts.filter((a) => a.kind === "diff")).length;
  const previews = groupArtifacts(artifacts.filter((a) => a.kind !== "diff")).length;
  const tabs: Array<{ id: WorkTab; label: string }> = [
    { id: "conversation", label: "Conversation" },
    { id: "plan", label: work?.status === "done" ? "Plan · done" : "Plan" },
    { id: "changes", label: changes ? `Changes · ${changes}` : "Changes" },
    { id: "preview", label: previews ? `Preview · ${previews}` : "Preview" },
  ];
  return (
    <div className="work-tabs" role="tablist" aria-label="Work">
      {tabs.map((entry) => (
        <button
          key={entry.id}
          role="tab"
          aria-selected={tab === entry.id}
          className="chip"
          data-active={tab === entry.id}
          onClick={() => onChange(entry.id)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}

export function WorkPanel({
  tab,
  channelId,
  work,
  artifacts,
}: {
  tab: Exclude<WorkTab, "conversation">;
  channelId: string;
  work: Work | null;
  artifacts: WorkArtifact[];
}) {
  if (tab === "plan") return <PlanTab channelId={channelId} work={work} />;
  if (tab === "changes")
    return (
      <ArtifactsTab
        which="changes"
        work={work}
        artifacts={artifacts.filter((a) => a.kind === "diff")}
      />
    );
  return (
    <ArtifactsTab
      which="preview"
      work={work}
      artifacts={artifacts.filter((a) => a.kind !== "diff")}
    />
  );
}

/** One run on the plan tab, subscribed to its own run. */
function PlanRun({ runId }: { runId: string }) {
  const run = useRun(runId);
  return run ? (
    <div>
      <AgentRunCard run={run} />
    </div>
  ) : null;
}

function PlanTab({
  channelId,
  work,
}: {
  channelId: string;
  work: Work | null;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const displayNameOf = useStore((s) => s.displayNameOf);
  const [finishing, setFinishing] = useState(false);
  // The plan is every run here, newest first, as ids: the tab redraws when a run joins,
  // and each card as its own run moves.
  const here = useRunIds(
    (run: AgentRunView) => run.channelId === channelId,
    (a, b) => (a.startedAt < b.startedAt ? 1 : -1),
  );
  const mayFinish =
    work?.status === "open" &&
    (work.createdBy === currentUser?.id ||
      currentUser?.role === "admin" ||
      currentUser?.role === "owner");

  return (
    <div className="work-panel">
      {work && (
        <div className="work-head">
          <div>
            <div className="work-title">{work.title}</div>
            <div className="pref-hint">
              Started by{" "}
              {work.createdBy ? displayNameOf(work.createdBy) : "someone"}
              {work.status === "done" ? " · done" : ""}
            </div>
          </div>
          {mayFinish && (
            <button
              className="btn btn-primary"
              disabled={finishing}
              onClick={async () => {
                setFinishing(true);
                try {
                  await api.work.done(work.id);
                } catch (err) {
                  showError(err);
                  setFinishing(false);
                }
              }}
            >
              {finishing ? "Finishing…" : "Mark done"}
            </button>
          )}
        </div>
      )}
      {here.length === 0 ? (
        <p className="pref-hint">
          No agent has worked here yet. Mention one and its plan appears here as
          it runs.
        </p>
      ) : (
        <div className="work-runs">
          {here.map((runId) => (
            <PlanRun key={runId} runId={runId} />
          ))}
        </div>
      )}
    </div>
  );
}
