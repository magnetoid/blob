/** Who has been invited, and who has not arrived yet. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminInvite } from "../../../lib/api.ts";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { CardNotice } from "../../console/Card.tsx";
import { useAdminAction } from '../../console/hooks.ts';

export function InvitationsSection({
  onError,
}: {
  onError: (message: string | null) => void;
}) {
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [link, setLink] = useState<string | null>(null);
  /** Whether the invitation actually went by email: null when nobody asked it to. */
  const [emailed, setEmailed] = useState<boolean | null>(null);

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

  // A fragment: the People page draws the card, and these are its children.
  return (
    <>
      <form
        className="console-inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const created = await api.auth.createInvite({
              email: email.trim() || undefined,
              role,
            });
            setLink(created.url);
            setEmailed(created.emailed ?? null);
            setEmail("");
          });
        }}
      >
        <label className="field">
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

      {link && emailed === false && (
        <p className="error-text">
          The email did not go out — this server cannot reach a mail server, so the link
          below is the only copy. Send it to them yourself, or set SMTP_HOST and
          MAIL_FROM and try again.
        </p>
      )}
      {link && emailed === true && (
        <p className="pref-hint">
          Emailed. The link is here too, in case it does not arrive.
        </p>
      )}

      {link && (
        <div className="draft-chip console-copy">
          <span className="grow ellipsis">{link}</span>
          <button
            className="btn btn-ghost"
            onClick={() => void navigator.clipboard.writeText(link)}
          >
            Copy
          </button>
        </div>
      )}

      {invites.length === 0 ? (
        <CardNotice>No invitations yet.</CardNotice>
      ) : (
      <div className="console-list">
        {invites.map((invite) => (
          <div
            className="admin-row"
            key={invite.id}
            data-inactive={invite.status !== "pending"}
          >
            <div className="grow min-0">
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
                aria-label={`Revoke the invitation to ${invite.email}`}
                onClick={() =>
                  void act(() => api.admin.revokeInvite(invite.id))
                }
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
      )}
    </>
  );
}
