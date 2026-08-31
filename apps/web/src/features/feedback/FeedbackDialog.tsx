/**
 * Reporting a bug, a request, or a note.
 *
 * The value of a ticket is mostly in what gets attached rather than what gets typed, so
 * the console log and a snapshot of the page are captured when the dialog opens —
 * before the reporter starts filling in the form and changes the page they are trying
 * to describe.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { trapFocus } from "../../lib/focusTrap.ts";
import { api } from "../../lib/api.ts";
import {
  capturePageSnapshot,
  describeEnvironment,
  readLog,
} from "../../lib/diagnostics.ts";

type Kind = "bug" | "feedback" | "feature";

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: "bug", label: "Bug", hint: "Something is broken or behaving oddly." },
  {
    id: "feature",
    label: "Feature",
    hint: "Something you would like Blob to do.",
  },
  { id: "feedback", label: "Feedback", hint: "Anything else worth saying." },
];

export function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const titleRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => trapFocus(dialogRef.current), []);
  const [kind, setKind] = useState<Kind>("bug");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attach, setAttach] = useState(true);

  // Taken once, at open. Capturing on submit would record the dialog rather than the
  // screen the report is about.
  const [captured] = useState(() => ({
    snapshot: capturePageSnapshot(),
    consoleLog: readLog(),
    environment: describeEnvironment(),
  }));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.feedback.submit({
        kind,
        title: title.trim(),
        body: body.trim(),
        environment: attach ? captured.environment : {},
        consoleLog: attach ? captured.consoleLog : "",
        snapshot: attach ? captured.snapshot : "",
      });
      setSent(true);
      window.setTimeout(onClose, 1400);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  const active = KINDS.find((entry) => entry.id === kind);

  // The backdrop is presentational. It was role="button" tabIndex={0}, which put a tab
  // stop announced as a button in front of the dialog and answered Space by closing it.
  // Clicking a backdrop is a pointer shortcut; the keyboard path is Escape, bound above.
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form
        className="dialog"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
      >
        <h2 className="dialog-title">Send feedback</h2>

        {sent ? (
          <p className="pref-hint">Thank you — an admin can see this now.</p>
        ) : (
          <>
            <div className="chip-row">
              {KINDS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="chip"
                  aria-pressed={kind === entry.id}
                  onClick={() => setKind(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className="pref-hint">{active?.hint}</p>

            <label className="field">
              <span className="field-label">Summary</span>
              <input
                ref={titleRef}
                className="input"
                value={title}
                maxLength={140}
                placeholder={
                  kind === "bug" ? "What went wrong?" : "In one line"
                }
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">Details</span>
              <textarea
                className="input"
                value={body}
                rows={5}
                maxLength={8000}
                placeholder={
                  kind === "bug"
                    ? "What were you doing, and what did you expect instead?"
                    : "Anything that would help us understand it."
                }
                onChange={(event) => setBody(event.target.value)}
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button
                type="button"
                className="toggle"
                aria-pressed={attach}
                onClick={() => setAttach((value) => !value)}
              >
                <span />
              </button>
              <span>
                <span className="pref-label">Attach diagnostics</span>
                <span className="pref-hint" style={{ display: "block" }}>
                  A snapshot of this page and the browser console, so an admin
                  can see what you saw. Passwords are never included.
                </span>
              </span>
            </div>

            {error && <p className="error-text">{error}</p>}

            <div className="dialog-actions">
              <button className="btn" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={!title.trim() || busy}
              >
                {busy ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
