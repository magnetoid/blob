/** Recording a decision, or rewording one (M2 · A8).
 *
 * One line for what was decided — the log's own limit, 200 characters — and room for why.
 * Recording from a message starts from that message's words, cut to a line: what was said
 * is usually most of what was decided, and the person trims the rest. The client id is
 * minted once, when the dialog opens, so a Save that times out and is pressed again
 * records one decision, not two.
 */

import { useState, type FormEvent } from "react";
import { ApiError } from "../../lib/api.ts";
import { Dialog } from "../../components/Dialog.tsx";
import { RATIONALE_MAX, TITLE_MAX } from "./decisionText.ts";

export function DecisionDialog({
  heading,
  initialTitle = "",
  initialRationale = "",
  saveLabel,
  onSave,
  onClose,
}: {
  heading: string;
  initialTitle?: string;
  initialRationale?: string;
  saveLabel: string;
  /** Rejects with the server's refusal, which the dialog shows in place. */
  onSave: (title: string, rationale: string, clientId: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [rationale, setRationale] = useState(initialRationale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());

  async function submit(event: FormEvent) {
    event.preventDefault();
    const line = title.replace(/\s+/g, " ").trim();
    if (!line) {
      setError("Say what was decided.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(line, rationale.trim(), clientId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "It could not be saved. Try again.");
      setBusy(false);
    }
  }

  return (
    <Dialog label={heading} onClose={onClose}>
      <form className="dialog" onSubmit={(event) => void submit(event)}>
        <h2 className="dialog-title">{heading}</h2>
        <label className="field">
          <span className="field-label">What was decided</span>
          <input
            className="input"
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">Why (optional)</span>
          <textarea
            className="input decision-why-input"
            value={rationale}
            maxLength={RATIONALE_MAX}
            rows={3}
            onChange={(event) => setRationale(event.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" data-refused="true">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Saving…" : saveLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
