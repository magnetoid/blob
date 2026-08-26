/** User groups — teams that can be mentioned as one name.
 *
 * Two screens behind one section: the list, and one group's membership at
 * `/workspace/groups/<id>`. That second URL is why `groups` is in
 * `WORKSPACE_DETAIL_SECTIONS` — without it the deep link falls through to the
 * conversation view and looks like a dead click.
 *
 * Built on `useAdminData`/`useAdminAction` like EmojiSection, rather than on the older
 * sections that hand-roll their own loading: those predate the hooks and skip the
 * stale-response guard the hooks exist to provide.
 */

import { useCallback, useState } from 'react';
import type { UserGroup } from '@blob/shared';
import { api, ApiError } from '../../../lib/api.ts';
import { navigate, pathForRoute } from '../../../lib/router.ts';
import { useStore } from '../../../lib/store.ts';
import { Avatar } from '../../../components/Avatar.tsx';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import type { AdminSectionProps } from '../AdminConsole.tsx';
import { useAdminAction, useAdminData } from '../hooks.ts';

/** Mirrors the server's rule, which mirrors what a message body can reference. */
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function GroupsSection({ onError, detailId }: AdminSectionProps) {
  if (detailId) return <GroupMembers groupId={detailId} onError={onError} />;
  return <GroupList onError={onError} />;
}

function GroupList({ onError }: { onError: (message: string | null) => void }) {
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<UserGroup | null>(null);
  const [renaming, setRenaming] = useState<UserGroup | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const load = useCallback(() => api.admin.groups(), []);
  const { data, reload } = useAdminData(load, [], onError, 'Could not load the groups.');
  const act = useAdminAction(onError, reload);

  const groups = data?.groups ?? [];
  const cleaned = handle.trim().replace(/^@/, '').toLowerCase();
  const usable = HANDLE_RE.test(cleaned) && name.trim().length > 0 && !busy;

  async function submit() {
    if (!usable) return;
    setBusy(true);
    onError(null);
    try {
      await api.admin.createGroup({ handle: cleaned, name: name.trim() });
      setHandle('');
      setName('');
      reload();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'That group could not be created.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ maxWidth: 680 }}>
      <div className="admin-app-form">
        <h4>New group</h4>
        <p className="muted">
          Anyone here can then write <code>@{cleaned || 'handle'}</code> to reach everyone
          in it. A handle shares one namespace with people's names, so it cannot be one
          somebody already answers to.
        </p>

        <label className="field" style={{ maxWidth: 280 }}>
          <span className="field-label">Handle</span>
          <input
            className="input"
            value={handle}
            placeholder="platform-team"
            onChange={(event) => setHandle(event.target.value)}
          />
          {handle && !HANDLE_RE.test(cleaned) && (
            <span className="pref-hint">
              Two to thirty-two characters: lowercase letters, numbers and hyphens.
            </span>
          )}
        </label>

        <label className="field" style={{ maxWidth: 280 }}>
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            placeholder="Platform Team"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <button
          className="btn btn-primary"
          disabled={!usable}
          onClick={() => void submit()}
          style={{ marginTop: 12 }}
        >
          {busy ? 'Creating…' : 'Create'}
        </button>
      </div>

      <div className="table-wrap" style={{ marginTop: 20 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Handle</th>
              <th>Name</th>
              <th>People</th>
              <th />
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
                    <form
                      style={{ display: 'flex', gap: 6 }}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const trimmed = renameDraft.trim();
                        setRenaming(null);
                        if (!trimmed || trimmed === group.name) return;
                        void act(async () => {
                          await api.admin.updateGroup(group.id, { name: trimmed });
                        });
                      }}
                    >
                      <input
                        className="input"
                        value={renameDraft}
                        maxLength={80}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setRenaming(null);
                        }}
                      />
                      <button className="btn" type="submit">
                        Save
                      </button>
                    </form>
                  ) : (
                    group.name
                  )}
                </td>
                <td className="muted">{group.memberCount}</td>
                <td>
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      navigate(
                        pathForRoute({
                          view: 'workspace',
                          section: 'groups',
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
                  <button className="btn btn-ghost" onClick={() => setRemoving(group)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  None yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {removing && (
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
    </section>
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
  const [query, setQuery] = useState('');

  const load = useCallback(
    async () => ({
      group: (await api.admin.groups()).groups.find((g) => g.id === groupId) ?? null,
      members: (await api.admin.groupMembers(groupId)).userIds,
    }),
    [groupId],
  );
  const { data, reload } = useAdminData(load, [groupId], onError, 'Could not load that group.');
  const act = useAdminAction(onError, reload);

  const memberIds = new Set(data?.members ?? []);
  const needle = query.trim().toLowerCase();
  // Bots are excluded on the server too — a group mention notifies through membership,
  // and a bot in a group would be a member that can never read it.
  const candidates = needle
    ? Object.values(users)
        .filter((u) => !u.deactivated && u.kind !== 'bot' && !memberIds.has(u.id))
        .filter((u) => u.displayName.toLowerCase().includes(needle))
        .slice(0, 6)
    : [];

  return (
    <section style={{ maxWidth: 640 }}>
      <button
        className="btn btn-ghost"
        onClick={() => navigate(pathForRoute({ view: 'workspace', section: 'groups' }))}
      >
        ← All groups
      </button>

      <h3 className="section-label" style={{ marginTop: 14 }}>
        {data?.group ? `@${data.group.handle}` : 'Group'}
      </h3>

      <label className="field" style={{ maxWidth: 280 }}>
        <span className="field-label">Add someone</span>
        <input
          className="input"
          value={query}
          placeholder="Start typing a name"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      {candidates.length > 0 && (
        <div className="member-candidates">
          {candidates.map((person) => (
            <button
              key={person.id}
              className="member-row"
              onClick={() =>
                void act(async () => {
                  await api.admin.addGroupMember(groupId, person.id);
                  setQuery('');
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

      <div className="member-list" style={{ marginTop: 12 }}>
        {data === null && <p className="muted">Loading…</p>}
        {data !== null && memberIds.size === 0 && (
          <p className="muted">Nobody is in this group yet.</p>
        )}
        {[...memberIds].map((userId) => {
          const person = users[userId];
          return (
            <div key={userId} className="member-row">
              <Avatar user={person} size="sm" />
              <span className="member-name">{person?.displayName ?? 'Someone'}</span>
              <button
                className="btn btn-ghost"
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
    </section>
  );
}
