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

import { useCallback, useId, useRef, useState } from "react";
import { api, ApiError, type WorkspaceEmoji } from "../../../lib/api.ts";
import { uploadFile } from "../../../lib/attachments.ts";
import { Card, CardNotice } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "../../../components/ui/field.tsx";
import { Input } from "../../../components/ui/input.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.tsx";

/** A table that runs to the card's edges: the first and last cell of a row give the card's
 * own padding back, so the words line up with the title above them. */
const TABLE_ROW = "*:first:pl-(--card-spacing) *:last:pr-(--card-spacing)";

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
  const fields = useId();

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
    <div className="flex flex-col gap-6">
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
          <Button disabled={!usable} onClick={() => void submit()}>
            {busy ? "Adding…" : "Add"}
          </Button>
        }
      >
        <div className="grid max-w-3xl gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${fields}-name`}>Name</FieldLabel>
            <Input
              id={`${fields}-name`}
              value={name}
              placeholder="party-parrot"
              aria-invalid={name !== "" && !NAME_RE.test(cleaned) ? true : undefined}
              aria-describedby={name && !NAME_RE.test(cleaned) ? `${fields}-name-hint` : undefined}
              onChange={(event) => setName(event.target.value)}
            />
            {name && !NAME_RE.test(cleaned) && (
              <FieldDescription id={`${fields}-name-hint`}>
                Two to thirty-two characters: lowercase letters, numbers,
                underscore, plus and hyphen.
              </FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor={`${fields}-image`}>Image</FieldLabel>
            <Input
              id={`${fields}-image`}
              ref={fileRef}
              type="file"
              name="emoji"
              accept="image/*"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
        </div>
      </Card>

      <Card>
        {emoji.length === 0 ? (
          <CardNotice>None yet.</CardNotice>
        ) : (
          <div className="-mx-(--card-spacing)">
            <Table>
              <TableHeader>
                <TableRow className={TABLE_ROW}>
                  <TableHead scope="col" className="w-10">
                    <span className="sr-only">Image</span>
                  </TableHead>
                  <TableHead scope="col">Name</TableHead>
                  <TableHead scope="col">Added by</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emoji.map((item: WorkspaceEmoji) => (
                  <TableRow key={item.name} className={TABLE_ROW}>
                    <TableCell>
                      <img src={item.url} alt="" width={24} height={24} />
                    </TableCell>
                    <TableCell>
                      <code>:{item.name}:</code>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.createdByName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          aria-label={`Remove :${item.name}:`}
                          onClick={() => setRemoving(item.name)}
                        >
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
