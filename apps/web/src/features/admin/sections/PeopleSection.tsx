/** Everyone in the workspace, and what they can do. */

import { useCallback, useEffect, useState } from 'react';
import { api, type AdminUser } from '../../../lib/api.ts';
import { useStore } from '../../../lib/store.ts';
import { Avatar } from '../../../components/Avatar.tsx';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { SearchIcon } from '../../../components/Icon.tsx';
import { formatRelative } from '../../messages/MessageRow.tsx';
import { useAdminAction } from '../hooks.ts';

export function PeopleSection({
  isOwner,
  onError,
}: {
  isOwner: boolean;
  onError: (message: string | null) => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void api.admin
      .users({ q: query || undefined })
      .then((r) => setUsers(r.users))
      .catch(() => onError('Could not load the directory.'))
      .finally(() => setLoading(false));
  }, [query, onError]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 220 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const act = useAdminAction(onError, load);

  return (
    <section>
      <div className="search-field" style={{ maxWidth: 320, marginBottom: 18 }}>
        <SearchIcon size={16} strokeWidth={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
        />
      </div>

      {loading && users.length === 0 ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="admin-table" role="table">
          {users.map((user) => (
            <div
              className="admin-row"
              role="row"
              key={user.id}
              data-inactive={user.deactivatedAt !== null}
            >
              <Avatar user={{ displayName: user.displayName, avatarUrl: null }} size="lg" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="admin-row-title">
                  {user.displayName}
                  {user.role !== 'member' && <span className="role-pill">{user.role}</span>}
                  {user.deactivatedAt && <span className="role-pill" data-muted>deactivated</span>}
                </div>
                <div className="admin-row-meta">
                  {user.email} · {user.messageCount} messages · {user.channelCount} channels
                  {user.lastSeenAt ? ` · seen ${formatRelative(user.lastSeenAt)}` : ' · never seen'}
                </div>
              </div>

              <div className="admin-row-actions">
                {isOwner && user.id !== currentUser?.id && !user.deactivatedAt && (
                  <select
                    className="chip"
                    value={user.role}
                    aria-label={`Role for ${user.displayName}`}
                    onChange={(e) =>
                      void act(() =>
                        api.admin.setRole(user.id, e.target.value as 'member' | 'admin' | 'owner'),
                      )
                    }
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                    <option value="owner">owner</option>
                  </select>
                )}
                {!user.deactivatedAt && user.sessionCount > 0 && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => void act(() => api.admin.revokeSessions(user.id))}
                    title={`Sign out of ${user.sessionCount} session(s)`}
                  >
                    Sign out
                  </button>
                )}
                {user.deactivatedAt ? (
                  <button
                    className="btn"
                    onClick={() => void act(() => api.admin.reactivate(user.id))}
                  >
                    Reactivate
                  </button>
                ) : (
                  user.role !== 'owner' &&
                  user.id !== currentUser?.id && (
                    <button className="btn" onClick={() => setDeactivating(user)}>
                      Deactivate
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && <p className="muted">Nobody matched “{query}”.</p>}
        </div>
      )}

      {deactivating && (
        <ConfirmDialog
          title={`Deactivate ${deactivating.displayName}?`}
          body="They are signed out everywhere and cannot sign back in. What they wrote stays."
          confirmLabel="Deactivate"
          danger
          onClose={() => setDeactivating(null)}
          onConfirm={() => {
            const user = deactivating;
            setDeactivating(null);
            void act(() => api.admin.deactivate(user.id));
          }}
        />
      )}
    </section>
  );
}
