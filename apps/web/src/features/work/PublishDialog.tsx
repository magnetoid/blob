/** Put something into the work by hand (M2 · A10): a change, a document or a page. The
 * same title and kind as something already there is its next version, and the dialog
 * says so before anybody presses Publish. */

import { useState } from "react";
import type { Work, WorkArtifact } from "@blob/shared";
import { Dialog } from "../../components/Dialog.tsx";
import { api } from "../../lib/api.ts";
import { showError } from "../../lib/toasts.ts";
import { artifactKey, groupArtifacts } from "./artifacts.ts";

const KINDS: Array<{ kind: WorkArtifact["kind"]; label: string; hint: string }> = [
  { kind: "diff", label: "Change", hint: "A unified diff, shown with its additions and removals." },
  { kind: "markdown", label: "Document", hint: "Markdown, shown the way messages are." },
  { kind: "html", label: "Page", hint: "HTML, run in a sandbox only when somebody asks." },
];

const TITLE_MAX = 200;
const BODY_MAX = 200_000;

export function PublishDialog({
  work,
  artifacts,
  kind: initialKind,
  onClose,
}: {
  work: Work;
  artifacts: WorkArtifact[];
  kind: WorkArtifact["kind"];
  onClose: () => void;
}) {
  const [kind, setKind] = useState<WorkArtifact["kind"]>(initialKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const existing = groupArtifacts(artifacts).find(
    (group) => group.key === artifactKey({ kind, title }),
  );
  const tooBig = new TextEncoder().encode(body).length > BODY_MAX;
  const ready = title.trim().length > 0 && body.trim().length > 0 && !tooBig && !busy;

  async function publish() {
    if (!ready) return;
    setBusy(true);
    try {
      await api.work.publish(work.id, { kind, title: title.trim(), body });
      onClose();
    } catch (err) {
      showError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog label="Publish into this work" onClose={onClose}>
      <div className="dialog">
        <h2 className="dialog-title">Publish</h2>
        <fieldset className="work-kind-pick">
          <legend className="field-label">What is it?</legend>
          {KINDS.map((entry) => (
            <label key={entry.kind} className="admin-scope-row">
              <input
                type="radio"
                name="artifact-kind"
                checked={kind === entry.kind}
                onChange={() => setKind(entry.kind)}
              />
              <span>
                {entry.label}
                <span className="pref-hint block">{entry.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span className="field-label">Title</span>
          <input
            className="input"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {existing && (
          <p className="pref-hint m-0">
            This will be v{existing.latest.version + 1} of {existing.latest.title}.
          </p>
        )}
        <label className="field">
          <span className="field-label">{kind === "diff" ? "Diff" : kind === "html" ? "HTML" : "Markdown"}</span>
          <textarea
            className="input work-publish-body"
            rows={12}
            value={body}
            spellCheck={kind === "markdown"}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        {tooBig && <p className="work-publish-error">That is more than 200 KiB.</p>}
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ready} onClick={() => void publish()}>
            {busy ? "Publishing…" : existing ? `Publish v${existing.latest.version + 1}` : "Publish"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
