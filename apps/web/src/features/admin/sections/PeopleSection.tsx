/** Everyone in the workspace, and what they can do. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminUser } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { Avatar } from "../../../components/Avatar.tsx";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { SearchIcon } from "../../../components/Icon.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { CardNotice } from "../../console/Card.tsx";
import { useAdminAction } from '../../console/hooks.ts';

/** "1 session", "2 sessions". */
function sessions(count: number): string {
  return count === 1 ? "1 session" : `${count} sessions`;
}

export function PeopleSection({
  isOwner,
  isInstanceAdmin = false,
  onError,
}: {
  isOwner: boolean;
  isInstanceAdmin?: boolean;
  onError: (message: string | null) => void;
}) {
  const currentUser = useStore((s) => s.currentUser);
  // The server's rule (services/admin `_may_act_on`): a member is any admin's to unlock
  // or sign out, an admin only the owner's, the owner only the server administrator's.
  // The server still decides — it also refuses an account held in other workspaces —
  // but a button that can only ever answer 403 is not offered.
  const mayActOn = (target: { role: string }) =>
    isInstanceAdmin || target.role === "member" || (target.role === "admin" && isOwner);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null);
  const [endingTwoStep, setEndingTwoStep] = useState<AdminUser | null>(null);
  /** A reset link just minted, shown once so it can be handed over. */
  const [resetLink, setResetLink] = useState<{ name: string; url: string } | null>(
    null,
  );

  const load = useCallback(() => {
    setLoading(true);
    void api.admin
      .users({ q: query || undefined })
      .then((r) => setUsers(r.users))
      .catch(() => onError("Could not load the directory."))
      .finally(() => setLoading(false));
  }, [query, onError]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 220 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const act = useAdminAction(onError, load);

  // A fragment: the People page draws the card this sits in, so the search and the rows
  // are the card's own children and take its rhythm and its flush list.
  return (
    <>
      <div className="console-toolbar">
        <div className="console-filter">
          <SearchIcon size="sm" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email"
            aria-label="Search people"
          />
        </div>
      </div>

      {loading && users.length === 0 ? (
        <CardNotice>Loading…</CardNotice>
      ) : users.length === 0 ? (
        <CardNotice>Nobody matched “{query}”.</CardNotice>
      ) : (
        // A list, not a table: these rows have no cells to be a table's rows, and axe
        // reads `role="row"` without them as broken structure (critical, in CI's scan).
        <div className="console-list" role="list">
          {users.map((user) => (
            <div
              className="admin-row"
              role="listitem"
              key={user.id}
              data-inactive={user.deactivatedAt !== null}
            >
              <Avatar
                user={{ displayName: user.displayName, avatarUrl: null }}
                size="lg"
              />
              <div className="grow min-0">
                <div className="admin-row-title">
                  {user.displayName}
                  {user.role !== "member" && (
                    <span className="role-pill">{user.role}</span>
                  )}
                  {user.placeholder ? (
                    // Brought over by an import (ADR 0042): somebody who can still be
                    // invited has not joined yet; an app, or somebody Slack gave no
                    // address, is a name on old messages and nothing more.
                    <span className="role-pill" data-muted>
                      {user.invitable ? 'not joined yet' : 'from Slack'}
                    </span>
                  ) : (
                    user.deactivatedAt && (
                      <span className="role-pill" data-muted>
                        deactivated
                      </span>
                    )
                  )}
                  {user.twoStep && !user.deactivatedAt && (
                    <span
                      className="role-pill"
                      data-muted
                      title="Signs in with a password and a passkey"
                    >
                      two-step
                    </span>
                  )}
                </div>
                <div className="admin-row-meta">
                  {user.placeholder && !user.invitable ? "no address" : user.email} ·{" "}
                  {user.messageCount} messages ·{" "}
                  {user.channelCount} channels
                  {user.lastSeenAt
                    ? ` · seen ${formatRelative(user.lastSeenAt)}`
                    : " · never seen"}
                </div>
              </div>

              <div className="admin-row-actions">
                {isOwner &&
                  user.id !== currentUser?.id &&
                  !user.deactivatedAt && (
                    <select
                      className="chip"
                      value={user.role}
                      aria-label={`Role for ${user.displayName}`}
                      onChange={(e) =>
                        void act(() =>
                          api.admin.setRole(
                            user.id,
                            e.target.value as "member" | "admin" | "owner" | "guest",
                          ),
                        )
                      }
                    >
                      <option value="guest">guest</option>
                      <option value="member">member</option>
                      <option value="admin">admin</option>
                      <option value="owner">owner</option>
                    </select>
                  )}
                {!user.deactivatedAt && mayActOn(user) && (
                  <button
                    className="btn btn-ghost"
                    aria-label={`Make a password reset link for ${user.displayName}`}
                    title="For when this server cannot send email"
                    onClick={() =>
                      void act(async () => {
                        const made = await api.admin.resetLink(user.id);
                        setResetLink({ name: user.displayName, url: made.url });
                      })
                    }
                  >
                    Reset link
                  </button>
                )}
                {!user.deactivatedAt &&
                  user.twoStep &&
                  user.id !== currentUser?.id &&
                  mayActOn(user) && (
                    <button
                      className="btn btn-ghost"
                      aria-label={`End two-step for ${user.displayName}: stop asking for a passkey`}
                      title="For someone who lost the devices their passkeys were on"
                      onClick={() => setEndingTwoStep(user)}
                    >
                      End two-step
                    </button>
                  )}
                {!user.deactivatedAt &&
                  user.sessionCount > 0 &&
                  (user.id === currentUser?.id || mayActOn(user)) && (
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      void act(() => api.admin.revokeSessions(user.id))
                    }
                    // The visible words first, so a voice command that says what it sees
                    // ("click Sign out") finds the button — WCAG 2.5.3.
                    aria-label={`Sign out ${user.displayName}: ${sessions(user.sessionCount)}`}
                    title={`Sign out of ${sessions(user.sessionCount)}`}
                  >
                    Sign out
                  </button>
                )}
                {user.placeholder ? (
                  user.invitable && (
                    <button
                      className="btn"
                      aria-label={`Invite ${user.displayName}`}
                      onClick={() =>
                        void act(() => api.auth.createInvite({ email: user.email }))
                      }
                    >
                      Invite
                    </button>
                  )
                ) : user.deactivatedAt ? (
                  <button
                    className="btn"
                    aria-label={`Reactivate ${user.displayName}`}
                    onClick={() =>
                      void act(() => api.admin.reactivate(user.id))
                    }
                  >
                    Reactivate
                  </button>
                ) : (
                  user.role !== "owner" &&
                  user.id !== currentUser?.id && (
                    <button
                      className="btn"
                      aria-label={`Deactivate ${user.displayName}`}
                      onClick={() => setDeactivating(user)}
                    >
                      Deactivate
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {resetLink && (
        <div className="draft-chip console-copy">
          <span className="grow ellipsis">
            For {resetLink.name}, good for an hour: {resetLink.url}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard.writeText(resetLink.url)}
          >
            Copy
          </button>
          <button className="btn btn-ghost" onClick={() => setResetLink(null)}>
            Done
          </button>
        </div>
      )}

      <DialogPresence when={endingTwoStep}>
        {(person) => (
          <ConfirmDialog
            title={`Stop asking ${person.displayName} for a passkey?`}
            body="Their password alone will sign them in again, in every workspace on this server. For someone who has lost the devices their passkeys were on; they can turn it back on themselves."
            confirmLabel="End two-step"
            onClose={() => setEndingTwoStep(null)}
            onConfirm={() => {
              const user = person;
              setEndingTwoStep(null);
              void act(() => api.admin.endTwoStep(user.id));
            }}
          />
        )}
      </DialogPresence>

      <DialogPresence when={deactivating}>
        {(deactivating) => (
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
      </DialogPresence>
    </>
  );
}
