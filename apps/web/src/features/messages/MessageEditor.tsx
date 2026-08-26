/**
 * The inline edit form for one message: draft, save, cancel, Escape. Mounted only
 * while its message is the one being edited — the store decides which one that is.
 */

import { useEffect, useRef, useState } from "react";
import type { Message } from "@blob/shared";
import { api } from "../../lib/api.ts";
import { showError } from "../../lib/toasts.ts";

interface Props {
  message: Message;
  onClose: () => void;
}

export function MessageEditor({ message, onClose }: Props) {
  const [draft, setDraft] = useState(message.body);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Re-seeded whenever the body changes under an open editor — an edit landing over
  // the socket — so saving cannot overwrite that edit with a stale draft. Running on
  // mount is what focuses the textarea for the ↑-from-composer path too.
  useEffect(() => {
    setDraft(message.body);
    editRef.current?.focus();
  }, [message.body]);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const trimmed = draft.trim();
        if (!trimmed) return;
        try {
          await api.messages.edit(message.id, trimmed);
        } catch (err) {
          // Keep the editor open with the text intact; closing it would
          // discard the words along with the failure.
          showError(err);
          return;
        }
        onClose();
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        marginTop: 4,
      }}
    >
      <textarea
        ref={editRef}
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={Math.min(10, draft.split("\n").length + 1)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(message.body);
            onClose();
          }
        }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" type="submit">
          Save
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            setDraft(message.body);
            onClose();
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
