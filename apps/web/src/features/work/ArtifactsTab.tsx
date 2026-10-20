/** The Changes and Preview tabs: every artifact once, its versions, and its review
 * (M2 · A10).
 *
 * An artifact published again under the same title is its next version, so the list stays
 * a list of things rather than of drafts; the detail can step back through versions. The
 * review bar under it is where a person says what they think of the version in front of
 * them — approve it, or send it back with what should change, which mentions its author in
 * the artifact's thread (an agent author is set going, on the reviewer's authority). The
 * thread is the conversation about the artifact, shared by its versions, and opens beside
 * the work like any other.
 */

import { useState } from "react";
import type { Work, WorkArtifact } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { showThread } from "../../lib/navigation.ts";
import { useStore } from "../../lib/store.ts";
import { showError } from "../../lib/toasts.ts";
import { groupArtifacts } from "./artifacts.ts";
import { diffStats, parseDiff } from "./diff.ts";
import { DiffView } from "./DiffView.tsx";
import { PublishDialog } from "./PublishDialog.tsx";
import { WorkPreview } from "./WorkPreview.tsx";

export function ArtifactsTab({
  which,
  work,
  artifacts,
}: {
  which: "changes" | "preview";
  work: Work | null;
  artifacts: WorkArtifact[];
}) {
  const displayNameOf = useStore((s) => s.displayNameOf);
  const groups = groupArtifacts(artifacts);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const open = work?.status === "open";

  const publish = open ? (
    <button type="button" className="btn" onClick={() => setPublishing(true)}>
      Publish
    </button>
  ) : null;
  const dialog = publishing && work && (
    <PublishDialog
      work={work}
      artifacts={artifacts}
      kind={which === "changes" ? "diff" : "markdown"}
      onClose={() => setPublishing(false)}
    />
  );

  if (groups.length === 0) {
    return (
      <div className="work-panel">
        <div className="work-tab-head">
          <p className="pref-hint m-0">
            {which === "changes"
              ? "No changes published yet. An agent publishes one with an AG-UI blob.artifact event; you can publish one yourself."
              : "Nothing to preview yet. Pages and documents agents publish land here; you can publish one yourself."}
          </p>
          {publish}
        </div>
        {dialog}
      </div>
    );
  }

  const group = groups.find((entry) => entry.key === openKey) ?? groups[0]!;
  const selected = group.versions.find((entry) => entry.id === versionId) ?? group.latest;

  return (
    <div className="work-panel work-split">
      <div className="work-side">
        <div className="work-tab-head">
          <span className="pref-hint">
            {groups.length} {which === "changes" ? "change" : "item"}
            {groups.length === 1 ? "" : "s"}
          </span>
          {publish}
        </div>
        <ul className="work-list">
          {groups.map((entry) => (
            <li key={entry.key}>
              <button
                className="menu-item"
                data-active={group.key === entry.key}
                onClick={() => {
                  setOpenKey(entry.key);
                  setVersionId(null);
                }}
              >
                <span className="work-list-title">
                  {entry.latest.title}
                  {entry.latest.version > 1 && (
                    <span className="work-version">v{entry.latest.version}</span>
                  )}
                </span>
                <span className="work-list-meta">
                  <Meta artifact={entry.latest} displayNameOf={displayNameOf} />
                  <Standing artifact={entry.latest} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="work-detail">
        <div className="work-detail-head">
          <div className="min-0">
            <div className="work-detail-title">{selected.title}</div>
            <div className="pref-hint">
              {selected.authorUserId ? displayNameOf(selected.authorUserId) : "Someone"}{" "}
              published v{selected.version} ·{" "}
              {new Date(selected.createdAt).toLocaleString()}
            </div>
          </div>
          {group.versions.length > 1 && (
            <select
              className="input work-version-pick"
              aria-label="Version"
              value={selected.id}
              onChange={(event) => setVersionId(event.target.value)}
            >
              {group.versions.map((version) => (
                <option key={version.id} value={version.id}>
                  v{version.version}
                  {version.id === group.latest.id ? " · latest" : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        {work && <ReviewBar key={`review:${selected.id}`} work={work} artifact={selected} />}
        {selected.kind === "diff" ? (
          <DiffView body={selected.body} />
        ) : (
          // Keyed so switching artifacts resets the run gate: a page you asked to run is
          // not permission for the next one, or for its next version.
          <WorkPreview key={`preview:${selected.id}`} artifact={selected} />
        )}
      </div>
      {dialog}
    </div>
  );
}

function Meta({
  artifact,
  displayNameOf,
}: {
  artifact: WorkArtifact;
  displayNameOf: (id: string) => string;
}) {
  const who = artifact.authorUserId ? displayNameOf(artifact.authorUserId) : "someone";
  if (artifact.kind !== "diff") return <>{artifact.kind === "html" ? "page" : "document"} · {who}</>;
  const stats = diffStats(parseDiff(artifact.body));
  return (
    <>
      {who} · <span className="diff-stat-add">+{stats.added}</span>{" "}
      <span className="diff-stat-del">−{stats.removed}</span>
    </>
  );
}

/** Where review stands on the newest version, in a word. */
function Standing({ artifact }: { artifact: WorkArtifact }) {
  if (artifact.reviews.some((review) => review.verdict === "changes")) {
    return <span className="work-standing" data-verdict="changes"> · changes requested</span>;
  }
  if (artifact.reviews.some((review) => review.verdict === "approved")) {
    return <span className="work-standing" data-verdict="approved"> · approved</span>;
  }
  return null;
}

function ReviewBar({ work, artifact }: { work: Work; artifact: WorkArtifact }) {
  const me = useStore((s) => s.currentUser);
  const displayNameOf = useStore((s) => s.displayNameOf);
  const author = useStore((s) =>
    artifact.authorUserId ? s.users[artifact.authorUserId] : undefined,
  );
  const [sendingBack, setSendingBack] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = artifact.reviews.find((review) => review.userId === me?.id);
  const open = work.status === "open";

  async function verdict(kind: "approved" | "changes") {
    if (busy) return;
    setBusy(true);
    try {
      await api.work.review(work.id, artifact.id, kind, kind === "changes" ? note.trim() : undefined);
      setSendingBack(false);
      setNote("");
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }

  async function discuss() {
    try {
      const { threadRootId } = await api.work.discuss(work.id, artifact.id);
      await showThread(work.channelId, threadRootId);
    } catch (err) {
      showError(err);
    }
  }

  return (
    <div className="work-review">
      <div className="work-verdicts">
        {artifact.reviews.length === 0 ? (
          <span className="pref-hint">Not reviewed yet.</span>
        ) : (
          artifact.reviews.map((review) => (
            <span
              key={review.userId}
              className="work-verdict"
              data-verdict={review.verdict}
              title={review.note ?? undefined}
            >
              {review.verdict === "approved" ? "Approved" : "Changes requested"} by{" "}
              {displayNameOf(review.userId)}
            </span>
          ))
        )}
      </div>
      {(open || artifact.reviewRootId) && (
        <div className="work-review-actions">
          <button type="button" className="btn btn-ghost" onClick={() => void discuss()}>
            {artifact.reviewRootId ? "Open the thread" : "Discuss"}
          </button>
          {open && (
            <>
              <button
                type="button"
                className="btn"
                disabled={busy || mine?.verdict === "approved"}
                onClick={() => void verdict("approved")}
              >
                {mine?.verdict === "approved" ? "Approved" : "Approve"}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                aria-expanded={sendingBack}
                onClick={() => setSendingBack((now) => !now)}
              >
                Request changes
              </button>
            </>
          )}
        </div>
      )}
      {sendingBack && open && (
        <form
          className="work-send-back"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim()) void verdict("changes");
          }}
        >
          <textarea
            className="input"
            rows={3}
            aria-label="What should change"
            placeholder="What should change?"
            value={note}
            maxLength={2000}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="work-send-back-actions">
            <span className="pref-hint">
              {author?.kind === "bot"
                ? `${author.displayName} is asked in the thread to make the change.`
                : author
                  ? `${author.displayName} hears about it in the thread.`
                  : "Said in the artifact’s thread."}
            </span>
            <button type="button" className="btn btn-ghost" onClick={() => setSendingBack(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!note.trim() || busy}>
              Send back
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
