/** Create a channel. */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { trapFocus } from "../../lib/focusTrap.ts";
import { channelNameSchema } from "@blob/shared";
import { api, ApiError } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { showChannel } from "../../lib/navigation.ts";

export function CreateChannelDialog({ onClose }: { onClose: () => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLFormElement>(null);

  useEffect(() => trapFocus(dialogRef.current), []);

  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = channelNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "That name will not work.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { channel } = await api.channels.create({
        name: parsed.data,
        kind: isPrivate ? "private" : "public",
        topic: topic.trim() || undefined,
      });
      useStore.setState((s) => ({
        channels: { ...s.channels, [channel.id]: channel },
      }));
      await showChannel(channel.id);
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not create that channel.",
      );
      setBusy(false);
    }
  }

  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (
          event.key === "Escape" ||
          event.key === "Enter" ||
          event.key === " "
        ) {
          event.preventDefault();
          onClose();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label="Close create channel dialog"
    >
      <form
        className="dialog"
        onSubmit={submit}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create a channel"
      >
        <h2 className="dialog-title">Create a channel</h2>

        <label className="field">
          <span className="field-label">Name</span>
          <input
            ref={nameRef}
            className="input"
            value={name}
            onChange={(e) =>
              setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))
            }
            placeholder="launch-planning"
            maxLength={64}
          />
        </label>

        <label className="field">
          <span className="field-label">Topic (optional)</span>
          <input
            className="input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="What belongs in here?"
            maxLength={250}
          />
        </label>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            className="toggle"
            aria-pressed={isPrivate}
            onClick={() => setIsPrivate((p) => !p)}
          >
            <span />
          </button>
          <span>
            <span className="pref-label">Private</span>
            <span className="pref-hint" style={{ display: "block" }}>
              Only invited people can find or read it.
            </span>
          </span>
        </div>

        {error && <p className="error-text">{error}</p>}

        <div className="dialog-actions">
          <button className="btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
