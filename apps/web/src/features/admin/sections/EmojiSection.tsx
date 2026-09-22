/** The workspace's own emoji.
 *
 * Everything about this feature already existed — the `custom_emoji` table, the bootstrap
 * payload, the file route that serves the images, and the picker that renders them. There
 * was simply no way to add one, so `:party-parrot:` could be referenced by anyone and
 * created by no one. This is the entrance.
 *
 * Uploads go through the ordinary attachment flow rather than one of their own: same
 * ticket, same presigned PUT, same rate limit. The emoji endpoint only names the result.
 */

import { useCallback, useRef, useState } from "react";
import { api, ApiError, type WorkspaceEmoji } from "../../../lib/api.ts";
import { uploadFile } from "../../../lib/attachments.ts";
import { Card, CardNotice } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";

/** Mirrors the server's rule, which mirrors what `:name:` in a body can match. */
const NAME_RE = /^[a-z0-9_+-]{2,32}$/;

export function EmojiSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.admin.customEmoji(), []);
  const { data, reload } = useAdminData(
    load,
    [],
    onError,
    "Could not load the emoji.",
  );
  const act = useAdminAction(onError, reload);

  const emoji = data?.emoji ?? [];
  const cleaned = name.trim().replace(/^:|:$/g, "").toLowerCase();
  const usable = NAME_RE.test(cleaned) && file !== null && !busy;

  async function submit() {
    if (!usable || !file) return;
    setBusy(true);
    onError(null);
    try {
      // Two calls, and the order matters: the image has to exist before it can be named,
      // and a failure here leaves an orphaned attachment rather than a broken emoji.
      const attachmentId = await uploadFile(file, file.type || "image/png");
      await api.admin.addCustomEmoji(cleaned, attachmentId);
      setName("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      reload();
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : "That emoji could not be added.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="console-stack">
      <Card
        title="Add an emoji"
        description={
          <>
            Anyone in the workspace can then type{" "}
            <code>:{cleaned || "name"}:</code> in a message, or pick it from the
            reaction toolbar.
          </>
        }
        footer={
          <button
            className="btn btn-primary"
            disabled={!usable}
            onClick={() => void submit()}
          >
            {busy ? "Adding…" : "Add"}
          </button>
        }
      >
        <div className="console-form-grid">
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={name}
              placeholder="party-parrot"
              onChange={(event) => setName(event.target.value)}
            />
            {name && !NAME_RE.test(cleaned) && (
              <span className="pref-hint">
                Two to thirty-two characters: lowercase letters, numbers,
                underscore, plus and hyphen.
              </span>
            )}
          </label>

          <label className="field">
            <span className="field-label">Image</span>
            <input
              ref={fileRef}
              className="input"
              type="file"
              name="emoji"
              aria-label="Choose an emoji image"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
        </div>
      </Card>

      <Card>
        {emoji.length === 0 ? (
          <CardNotice>None yet.</CardNotice>
        ) : (
          <div className="console-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col" className="console-cell-emoji">
                    <span className="sr-only">Image</span>
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Added by</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {emoji.map((item: WorkspaceEmoji) => (
                  <tr key={item.name}>
                    <td className="console-cell-emoji">
                      <img src={item.url} alt="" width={24} height={24} />
                    </td>
                    <td>
                      <code>:{item.name}:</code>
                    </td>
                    <td className="muted">{item.createdByName ?? "—"}</td>
                    <td className="console-cell-actions">
                      <button
                        className="btn btn-ghost"
                        aria-label={`Remove :${item.name}:`}
                        onClick={() => setRemoving(item.name)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DialogPresence when={removing}>
        {(removing) => (
          <ConfirmDialog
            title={`Remove :${removing}:?`}
            body="Messages that used it will show the text instead. Reactions already given keep it."
            confirmLabel="Remove"
            danger
            onClose={() => setRemoving(null)}
            onConfirm={() => {
              const name = removing;
              setRemoving(null);
              void act(async () => {
                await api.admin.removeCustomEmoji(name);
              });
            }}
          />
        )}
      </DialogPresence>
    </div>
  );
}
