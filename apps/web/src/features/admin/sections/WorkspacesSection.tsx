/** Every workspace on this server, and the way to make another.
 *
 * Creating one makes you its owner, carrying the password you already have — one address
 * is one password across every workspace it holds an account in, which is the rule
 * `services/workspaces` exists to keep. Nobody else is added; a workspace starts with one
 * person in it, and an invitation is how it gets a second.
 */

import { useCallback, useState } from "react";
import { api, type InstanceWorkspace } from "../../../lib/api.ts";
import { useAdminAction, useAdminData } from "../hooks.ts";

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

export function WorkspacesSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const load = useCallback(() => api.admin.instanceWorkspaces(), []);
  const { data, reload } = useAdminData(
    load,
    [],
    onError,
    "Could not load workspaces.",
  );
  const act = useAdminAction(onError, reload);

  const workspaces = data?.workspaces ?? [];

  return (
    <section>
      <form
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          marginBottom: 16,
        }}
        onSubmit={(event) => {
          event.preventDefault();
          const wanted = name.trim();
          if (!wanted) return;
          void act(async () => {
            await api.admin.createWorkspace(wanted);
            setName("");
          });
        }}
      >
        <label className="field" style={{ margin: 0, maxWidth: 280 }}>
          <span className="field-label">New workspace</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Acme"
          />
        </label>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={!name.trim()}
        >
          Create
        </button>
      </form>

      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Members</th>
              <th>Channels</th>
              <th>Apps</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {workspaces.map((workspace: InstanceWorkspace) => (
              <tr key={workspace.id}>
                <td>{workspace.name}</td>
                <td className="muted">{workspace.slug}</td>
                <td>{workspace.memberCount}</td>
                <td>{workspace.channelCount}</td>
                <td>{workspace.appCount}</td>
                <td className="muted">{formatDate(workspace.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
