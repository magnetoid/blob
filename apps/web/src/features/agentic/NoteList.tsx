/** The notes agents kept, a note a row (M2 · A8).
 *
 * Shared by the two places a note can be read and corrected, as `MemoryList` is: Settings,
 * where a person sees what agents they own or borrow noted of their own conversations, and
 * an agent's console page, where an admin sees what it noted of conversations they can see.
 * Unlike a memory, a note is words — so it can be reworded here, not only forgotten, which
 * is what to do with an agent that learned something almost right.
 */

import { useState, type FormEvent } from "react";
import type { AgentNote } from "../../lib/api.ts";
import { useStore } from "../../lib/store.ts";
import { formatRelative } from "../messages/messageFormatting.ts";

/** The server's limit on a note, `services/agent_notes.py`. */
const NOTE_MAX = 500;

export function NoteList({
  notes,
  showAgent,
  onReword,
  onForget,
}: {
  notes: AgentNote[];
  /** Name the agent on each row — Settings lists several agents' notes at once. */
  showAgent: boolean;
  onReword: (note: AgentNote, body: string) => Promise<unknown>;
  onForget: (note: AgentNote) => void;
}) {
  const channels = useStore((s) => s.channels);
  const channelTitle = useStore((s) => s.channelTitle);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(event: FormEvent, note: AgentNote) {
    event.preventDefault();
    if (!draft.trim()) return;
    setSaving(true);
    try {
      await onReword(note, draft.trim());
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="console-list">
      {notes.map((note) => {
        const channel = channels[note.channelId];
        const where = channel
          ? channelTitle(channel)
          : note.channelName
            ? `#${note.channelName}`
            : "a conversation";
        const open = editing === note.id;
        return (
          <div className="console-list-item" key={note.id}>
            <div className="admin-row">
              <div className="grow min-0">
                {open ? (
                  <form
                    className="note-edit"
                    onSubmit={(event) => void save(event, note)}
                  >
                    <textarea
                      className="input"
                      aria-label="Note"
                      value={draft}
                      maxLength={NOTE_MAX}
                      rows={3}
                      onChange={(event) => setDraft(event.target.value)}
                    />
                    <div className="console-form-actions">
                      <button
                        className="btn btn-primary"
                        type="submit"
                        disabled={saving}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="note-body">{note.body}</p>
                )}
                <div className="admin-row-meta">
                  {showAgent && `${note.agentName} · `}
                  {where} · written {formatRelative(note.updatedAt)}
                </div>
              </div>
              {!open && (
                <div className="admin-row-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setEditing(note.id);
                      setDraft(note.body);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => onForget(note)}
                  >
                    Forget
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
