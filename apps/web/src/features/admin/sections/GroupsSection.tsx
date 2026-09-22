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

import { useCallback, useState } from "react";
import type { UserGroup } from "@blob/shared";
import { api, ApiError } from "../../../lib/api.ts";
import { navigate, pathForRoute } from "../../../lib/router.ts";
import { useStore } from "../../../lib/store.ts";
import { Avatar } from "../../../components/Avatar.tsx";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { Card, CardHeading, CardNotice } from "../../console/Card.tsx";
import { useAdminAction, useAdminData } from '../../console/hooks.ts';

/** Mirrors the server's rule, which mirrors what a message body can reference. */
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

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
      <p className="pref-hint">
        Anyone here can then write <code>@{cleaned || "handle"}</code> to
        reach everyone in it. A handle shares one namespace with people's
        names, so it cannot be one somebody already answers to.
      </p>

      <div className="console-form-grid">
        <label className="field">
          <span className="field-label">Handle</span>
          <input
            className="input"
            value={handle}
            placeholder="platform-team"
            onChange={(event) => setHandle(event.target.value)}
          />
          {handle && !HANDLE_RE.test(cleaned) && (
            <span className="pref-hint">
              Two to thirty-two characters: lowercase letters, numbers and
              hyphens.
            </span>
          )}
        </label>

        <label className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            placeholder="Platform Team"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>

      <div className="console-form-actions">
        <button
          className="btn btn-primary"
          disabled={!usable}
          onClick={() => void submit()}
        >
          {busy ? "Creating…" : "Create"}
        </button>
      </div>

      {groups.length === 0 ? (
        <CardNotice>None yet.</CardNotice>
      ) : (
      <div className="console-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th scope="col">Handle</th>
              <th scope="col">Name</th>
              <th scope="col" className="num">People</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.id}>
                <td>
                  <code>@{group.handle}</code>
                </td>
                <td>
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
                </td>
                <td className="num">{group.memberCount}</td>
                <td className="console-cell-actions">
                  <button
                    className="btn btn-ghost"
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
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setRenaming(group);
                      setRenameDraft(group.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="btn btn-ghost"
                    aria-label={`Delete @${group.handle}`}
                    onClick={() => setRemoving(group)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
      className="console-inline-form"
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
      <input
        ref={focusInput}
        className="input"
        aria-label={`New name for @${group.handle}`}
        value={renameDraft}
        maxLength={80}
        onChange={(e) => setRenameDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setRenaming(null);
        }}
      />
      <button className="btn" type="submit">
        Save
      </button>
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
    <div className="console-stack">
      <button
        className="btn btn-ghost console-back"
        onClick={() =>
          navigate(pathForRoute({ view: "admin", section: "groups" }))
        }
      >
        ← All groups
      </button>

      <Card title={data?.group ? `@${data.group.handle}` : "Group"}>
        <label className="field console-input">
          <span className="field-label">Add someone</span>
          <input
            className="input"
            value={query}
            placeholder="Start typing a name"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {candidates.length > 0 && (
          <div className="member-candidates console-input">
            {candidates.map((person) => (
              <button
                key={person.id}
                className="member-row"
                onClick={() =>
                  void act(async () => {
                    await api.admin.addGroupMember(groupId, person.id);
                    setQuery("");
                  })
                }
              >
                <Avatar user={person} size="sm" />
                <span className="member-name">{person.displayName}</span>
                <span className="muted">Add</span>
              </button>
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
          <div className="console-list">
            {[...memberIds].map((userId) => {
              const person = users[userId];
              return (
                <div key={userId} className="admin-row">
                  <Avatar user={person} size="sm" />
                  <span className="grow min-0 ellipsis">
                    {person?.displayName ?? "Someone"}
                  </span>
                  <button
                    className="btn btn-ghost"
                    aria-label={`Remove ${person?.displayName ?? "this person"} from the group`}
                    onClick={() =>
                      void act(async () => {
                        await api.admin.removeGroupMember(groupId, userId);
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
