/** Every account on the server.
 *
 * Not the same page as the workspace's Members list, and the difference is the point:
 * that one is "who is in here, and what may they do", with the controls to change it.
 * This one is "who exists on this machine at all", grouped by the workspace they belong
 * to. Roles are changed where a role means something, which is inside a workspace.
 *
 * Bots are shown rather than filtered out. An app's bot is a real user row — that is the
 * decision ADR 0005 rests on — and an instance operator counting accounts should see the
 * same rows the database has.
 */

import { useCallback, useMemo, useState } from 'react';
import { api, type InstanceUser } from '../../../lib/api.ts';
import { useAdminData } from '../hooks.ts';

export function AccountsSection({ onError }: { onError: (message: string | null) => void }) {
  const [query, setQuery] = useState('');

  const load = useCallback(() => api.admin.instanceUsers(), []);
  const { data } = useAdminData(load, [], onError, 'Could not load accounts.');

  const users = useMemo(() => data?.users ?? [], [data]);
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.displayName.toLowerCase().includes(needle) ||
        u.email.toLowerCase().includes(needle) ||
        u.workspaceName.toLowerCase().includes(needle),
    );
  }, [users, query]);

  const humans = users.filter((u) => u.kind === 'human').length;

  return (
    <section>
      <p className="muted" style={{ marginBottom: 12 }}>
        {users.length} {users.length === 1 ? 'account' : 'accounts'} — {humans} human,{' '}
        {users.length - humans} bot.
      </p>

      <div className="search-field" style={{ marginBottom: 12, maxWidth: 320 }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find an account"
          aria-label="Find an account"
        />
      </div>

      {shown.length === 0 ? (
        <p className="muted">Nothing matched.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Workspace</th>
                <th>Role</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((user: InstanceUser) => (
                <tr key={user.id}>
                  <td>
                    {user.displayName}
                    {user.kind === 'bot' && <span className="role-pill">App</span>}
                  </td>
                  <td className="muted">{user.email}</td>
                  <td>{user.workspaceName}</td>
                  <td>{user.role}</td>
                  <td className="muted">{user.deactivated ? 'Deactivated' : 'Active'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
