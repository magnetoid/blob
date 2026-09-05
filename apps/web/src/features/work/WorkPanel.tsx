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

import { useMemo, useState } from "react";
import type { AgentRunView, Work, WorkArtifact } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { showError } from "../../lib/toasts.ts";
import { AgentRunCard } from "../messages/AgentRunCard.tsx";
import { diffStats, parseDiff } from "./diff.ts";
import { DiffView } from "./DiffView.tsx";
import { WorkPreview } from "./WorkPreview.tsx";

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
  const changes = artifacts.filter((a) => a.kind === "diff").length;
  const previews = artifacts.filter((a) => a.kind !== "diff").length;
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
      <ChangesTab artifacts={artifacts.filter((a) => a.kind === "diff")} />
    );
  return <PreviewTab artifacts={artifacts.filter((a) => a.kind !== "diff")} />;
}

function PlanTab({
  channelId,
  work,
}: {
  channelId: string;
  work: Work | null;
}) {
  const runs = useStore((s) => s.agentRuns);
  const currentUser = useStore((s) => s.currentUser);
  const displayNameOf = useStore((s) => s.displayNameOf);
  const [finishing, setFinishing] = useState(false);
  const here = useMemo(
    () =>
      Object.values(runs)
        .filter((run: AgentRunView) => run.channelId === channelId)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    [runs, channelId],
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
          {here.map((run) => (
            <AgentRunCard key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangesTab({ artifacts }: { artifacts: WorkArtifact[] }) {
  const [open, setOpen] = useState<string | null>(artifacts[0]?.id ?? null);
  const displayNameOf = useStore((s) => s.displayNameOf);
  if (artifacts.length === 0) {
    return (
      <div className="work-panel">
        <p className="pref-hint">
          No changes published yet. An agent publishes a diff with an AG-UI{" "}
          <code>blob.artifact</code> event; you can paste one from the ••• menu
          of this tab later.
        </p>
      </div>
    );
  }
  const selected = artifacts.find((a) => a.id === open) ?? artifacts[0]!;
  return (
    <div className="work-panel work-split">
      <ul className="work-list">
        {artifacts.map((artifact) => {
          const stats = diffStats(parseDiff(artifact.body));
          return (
            <li key={artifact.id}>
              <button
                className="menu-item"
                data-active={selected.id === artifact.id}
                onClick={() => setOpen(artifact.id)}
              >
                <span className="work-list-title">{artifact.title}</span>
                <span className="work-list-meta">
                  {artifact.authorUserId
                    ? displayNameOf(artifact.authorUserId)
                    : "someone"}{" "}
                  · <span className="diff-stat-add">+{stats.added}</span>{" "}
                  <span className="diff-stat-del">−{stats.removed}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="work-detail">
        <DiffView body={selected.body} />
      </div>
    </div>
  );
}

function PreviewTab({ artifacts }: { artifacts: WorkArtifact[] }) {
  const [open, setOpen] = useState<string | null>(artifacts[0]?.id ?? null);
  const displayNameOf = useStore((s) => s.displayNameOf);
  if (artifacts.length === 0) {
    return (
      <div className="work-panel">
        <p className="pref-hint">
          Nothing to preview yet. Pages and documents agents publish land here.
        </p>
      </div>
    );
  }
  const selected = artifacts.find((a) => a.id === open) ?? artifacts[0]!;
  return (
    <div className="work-panel work-split">
      <ul className="work-list">
        {artifacts.map((artifact) => (
          <li key={artifact.id}>
            <button
              className="menu-item"
              data-active={selected.id === artifact.id}
              onClick={() => setOpen(artifact.id)}
            >
              <span className="work-list-title">{artifact.title}</span>
              <span className="work-list-meta">
                {artifact.kind} ·{" "}
                {artifact.authorUserId
                  ? displayNameOf(artifact.authorUserId)
                  : "someone"}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="work-detail">
        {/* Keyed so switching artifacts resets the run gate: a page you asked to run is
            not permission for the next one. */}
        <WorkPreview key={selected.id} artifact={selected} />
      </div>
    </div>
  );
}
