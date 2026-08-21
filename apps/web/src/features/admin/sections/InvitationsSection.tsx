/** Who has been invited, and who has not arrived yet. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminInvite } from "../../../lib/api.ts";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { useAdminAction } from "../hooks.ts";

export function InvitationsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [link, setLink] = useState<string | null>(null);

  const load = useCallback(() => {
    void api.admin
      .invites()
      .then((r) => setInvites(r.invites))
      .catch(() => onError("Could not load invitations."));
  }, [onError]);

  useEffect(() => {
    const timer = setTimeout(load, 0);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAdminAction(onError, load);

  return (
    <section>
      <form
        style={{
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          marginBottom: 20,
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const created = await api.auth.createInvite({
              email: email.trim() || undefined,
              role,
            });
            setLink(created.url);
            setEmail("");
          });
        }}
      >
        <label className="field" style={{ flex: 1, maxWidth: 260 }}>
          <span className="field-label">Email (optional)</span>
          <input
            className="input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Leave blank for a shareable link"
          />
        </label>
        <label className="field">
          <span className="field-label">Joins as</span>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin")}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <button className="btn btn-primary" type="submit">
          Create invitation
        </button>
      </form>

      {link && (
        <div className="draft-chip" style={{ marginBottom: 18, width: "100%" }}>
          <span
            style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {link}
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard.writeText(link)}
          >
            Copy
          </button>
        </div>
      )}

      <div className="admin-table">
        {invites.map((invite) => (
          <div
            className="admin-row"
            key={invite.id}
            data-inactive={invite.status !== "pending"}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="admin-row-title">
                {invite.email ?? "Shareable link"}
                <span
                  className="role-pill"
                  data-muted={invite.status !== "pending"}
                >
                  {invite.status}
                </span>
                {invite.role !== "member" && (
                  <span className="role-pill">{invite.role}</span>
                )}
              </div>
              <div className="admin-row-meta">
                Created by {invite.createdByName ?? "someone"}{" "}
                {formatRelative(invite.createdAt)}
                {invite.acceptedByName &&
                  ` · accepted by ${invite.acceptedByName}`}
              </div>
            </div>
            {invite.status === "pending" && (
              <button
                className="btn"
                onClick={() =>
                  void act(() => api.admin.revokeInvite(invite.id))
                }
              >
                Revoke
              </button>
            )}
          </div>
        ))}
        {invites.length === 0 && <p className="muted">No invitations yet.</p>}
      </div>
    </section>
  );
}
