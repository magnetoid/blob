/** User groups — teams that can be mentioned as one name.
 *
 * Two screens behind one section: the list, and one group's membership at
 * `/admin/groups/<id>`. That second URL is why `groups` is in
 * `ADMIN_DETAIL_SECTIONS` — without it the deep link falls through to the
 * conversation view and looks like a dead click.
 *
 * Built on `useAdminData`/`useAdminAction` like EmojiSection, rather than on the older
 * sections that hand-roll their own loading: those predate the hooks and skip the
 * stale-response guard the hooks exist to provide.
 */

import { useCallback, useId, useState } from "react";
import type { UserGroup } from "@blob/shared";
import { api, ApiError } from "../../../lib/api.ts";
import { navigate, pathForRoute } from "../../../lib/router.ts";
import { useStore } from "../../../lib/store.ts";
import { Avatar } from "../../../components/Avatar.tsx";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { ChevronLeftIcon } from "../../../components/Icon.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "../../../components/ui/field.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { ItemActions, ItemContent, ItemMedia, ItemTitle } from "../../../components/ui/item.tsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../components/ui/table.tsx";
import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { Card, CardHeading, CardNotice, CardRow, CardRows } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

/** Mirrors the server's rule, which mirrors what a message body can reference. */
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** A table that runs to the card's edges: the first and last cell of a row give the card's
 * own padding back, so the words line up with the title above them. */
const TABLE_ROW = "*:first:pl-(--card-spacing) *:last:pr-(--card-spacing)";

export function GroupsSection({ onError, detailId }: ConsoleSectionProps) {
  if (detailId) return <GroupMembers groupId={detailId} onError={onError} />;
  return <GroupList onError={onError} />;
}

function GroupList({ onError }: { onError: (message: string | null) => void }) {
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<UserGroup | null>(null);
  const [renaming, setRenaming] = useState<UserGroup | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const fields = useId();

  const load = useCallback(() => api.admin.groups(), []);
  const { data, reload } = useAdminData(
    load,
    [],
    onError,
    "Could not load the groups.",
  );
  const act = useAdminAction(onError, reload);

  const groups = data?.groups ?? [];
  const cleaned = handle.trim().replace(/^@/, "").toLowerCase();
  const usable = HANDLE_RE.test(cleaned) && name.trim().length > 0 && !busy;

  async function submit() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      await api.admin.createGroup({ handle: cleaned, name: name.trim() });
      setHandle("");
      setName("");
      reload();
    } catch (err) {
      onError(
        err instanceof ApiError
          ? err.message
          : "That group could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  // A fragment: whoever frames this — the People page, or AdminConsole for the old
  // /admin/groups URL — draws the card, and these are its children. The heading takes
  // its level from that card, which is titled on the one page and not on the other.
  return (
    <>
      <CardHeading>New group</CardHeading>
      <p className="max-w-[68ch] text-sm text-pretty text-muted-foreground">
        Anyone here can then write <code>@{cleaned || "handle"}</code> to
        reach everyone in it. A handle shares one namespace with people's
        names, so it cannot be one somebody already answers to.
      </p>

      <div className="grid max-w-3xl gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${fields}-handle`}>Handle</FieldLabel>
          <Input
            id={`${fields}-handle`}
            value={handle}
            placeholder="platform-team"
            aria-invalid={handle !== "" && !HANDLE_RE.test(cleaned) ? true : undefined}
            aria-describedby={handle && !HANDLE_RE.test(cleaned) ? `${fields}-handle-hint` : undefined}
            onChange={(event) => setHandle(event.target.value)}
          />
          {handle && !HANDLE_RE.test(cleaned) && (
            <FieldDescription id={`${fields}-handle-hint`}>
              Two to thirty-two characters: lowercase letters, numbers and
              hyphens.
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor={`${fields}-name`}>Name</FieldLabel>
          <Input
            id={`${fields}-name`}
            value={name}
            placeholder="Platform Team"
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
      </div>

      <Button className="self-start" disabled={!usable} onClick={() => void submit()}>
        {busy ? "Creating…" : "Create"}
      </Button>

      {groups.length === 0 ? (
        <CardNotice>None yet.</CardNotice>
      ) : (
        // Edge to edge, as the lists are: the card's padding comes back on the first and
        // last cell of each row.
        <div className="-mx-(--card-spacing)">
          <Table>
            <TableHeader>
              <TableRow className={TABLE_ROW}>
                <TableHead scope="col">Handle</TableHead>
                <TableHead scope="col">Name</TableHead>
                <TableHead scope="col" className="text-right">
                  People
                </TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id} className={TABLE_ROW}>
                  <TableCell>
                    <code>@{group.handle}</code>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {renaming?.id === group.id ? (
                      <RenameGroupForm
                        group={group}
                        renameDraft={renameDraft}
                        setRenameDraft={setRenameDraft}
                        setRenaming={setRenaming}
                        act={act}
                      />
                    ) : (
                      group.name
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{group.memberCount}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        aria-label={`Members of @${group.handle}`}
                        onClick={() =>
                          navigate(
                            pathForRoute({
                              view: "admin",
                              section: "groups",
                              detailId: group.id,
                            }),
                          )
                        }
                      >
                        Members
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Rename @${group.handle}`}
                        onClick={() => {
                          setRenaming(group);
                          setRenameDraft(group.name);
                        }}
                      >
                        Rename
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`Delete @${group.handle}`}
                        onClick={() => setRemoving(group)}
                      >
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DialogPresence when={removing}>
        {(removing) => (
          <ConfirmDialog
            title={`Delete @${removing.handle}?`}
            body="Messages that mentioned it keep saying so — the mention happened. It simply stops reaching anyone, and the handle becomes free again."
            confirmLabel="Delete"
            danger
            onClose={() => setRemoving(null)}
            onConfirm={() => {
              const group = removing;
              setRemoving(null);
              void act(async () => {
                await api.admin.deleteGroup(group.id);
              });
            }}
          />
        )}
      </DialogPresence>
    </>
  );
}

function RenameGroupForm({
  group,
  renameDraft,
  setRenameDraft,
  setRenaming,
  act,
}: {
  group: UserGroup;
  renameDraft: string;
  setRenameDraft: (value: string) => void;
  setRenaming: (group: UserGroup | null) => void;
  act: (run: () => Promise<unknown>) => Promise<void>;
}) {
  const focusInput = useCallback((node: HTMLInputElement | null) => {
    node?.focus();
  }, []);

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = renameDraft.trim();
        setRenaming(null);
        if (!trimmed || trimmed === group.name) return;
        void act(async () => {
          await api.admin.updateGroup(group.id, {
            name: trimmed,
          });
        });
      }}
    >
      {/* It replaces the name in its cell, so nothing on screen labels it; the name it
          would have had as a visible label is the one it gets. */}
      <Input
        ref={focusInput}
        aria-label={`New name for @${group.handle}`}
        value={renameDraft}
        maxLength={80}
        onChange={(e) => setRenameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setRenaming(null);
        }}
      />
      <Button variant="outline" type="submit">
        Save
      </Button>
    </form>
  );
}

function GroupMembers({
  groupId,
  onError,
}: {
  groupId: string;
  onError: (message: string | null) => void;
}) {
  const users = useStore((s) => s.users);
  const [query, setQuery] = useState("");
  const fields = useId();

  const load = useCallback(
    async () => ({
      group:
        (await api.admin.groups()).groups.find((g) => g.id === groupId) ?? null,
      members: (await api.admin.groupMembers(groupId)).userIds,
    }),
    [groupId],
  );
  const { data, loading, reload } = useAdminData(
    load,
    [groupId],
    onError,
    "Could not load that group.",
  );
  const act = useAdminAction(onError, reload);

  const memberIds = new Set(data?.members ?? []);
  const needle = query.trim().toLowerCase();
  // Bots are excluded on the server too — a group mention notifies through membership,
  // and a bot in a group would be a member that can never read it.
  const candidates = needle
    ? Object.values(users)
        .filter(
          (u) => !u.deactivated && u.kind !== "bot" && !memberIds.has(u.id),
        )
        .filter((u) => u.displayName.toLowerCase().includes(needle))
        .slice(0, 6)
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Button
        variant="ghost"
        className="self-start"
        onClick={() =>
          navigate(pathForRoute({ view: "admin", section: "groups" }))
        }
      >
        <ChevronLeftIcon size="sm" />
        All groups
      </Button>

      <Card title={data?.group ? `@${data.group.handle}` : "Group"}>
        <Field className="max-w-md">
          <FieldLabel htmlFor={`${fields}-add`}>Add someone</FieldLabel>
          <Input
            id={`${fields}-add`}
            value={query}
            placeholder="Start typing a name"
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>

        {candidates.length > 0 && (
          <div
            role="group"
            aria-label="People you can add"
            className="flex max-w-md flex-col overflow-clip rounded-lg border"
          >
            {candidates.map((person) => (
              <Button
                key={person.id}
                variant="ghost"
                className="h-auto justify-start gap-2.5 rounded-none px-3 py-2"
                onClick={() =>
                  void act(async () => {
                    await api.admin.addGroupMember(groupId, person.id);
                    setQuery("");
                  })
                }
              >
                <Avatar user={person} size="sm" />
                <span className="flex-1 text-left">{person.displayName}</span>
                <span className="font-normal text-muted-foreground">Add</span>
              </Button>
            ))}
          </div>
        )}

        {/* No data and no request in flight means the load failed: the error above says
            so, and this says nothing rather than "Loading…" for ever. */}
        {data === null ? (
          loading && <CardNotice>Loading…</CardNotice>
        ) : memberIds.size === 0 ? (
          <CardNotice>Nobody is in this group yet.</CardNotice>
        ) : (
          <CardRows>
            {[...memberIds].map((userId) => {
              const person = users[userId];
              return (
                <CardRow key={userId}>
                  <ItemMedia>
                    <Avatar user={person} size="sm" />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{person?.displayName ?? "Someone"}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${person?.displayName ?? "this person"} from the group`}
                      onClick={() =>
                        void act(async () => {
                          await api.admin.removeGroupMember(groupId, userId);
                        })
                      }
                    >
                      Remove
                    </Button>
                  </ItemActions>
                </CardRow>
              );
            })}
          </CardRows>
        )}
      </Card>
    </div>
  );
}
