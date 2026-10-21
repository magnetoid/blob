/** Who has been invited, and who has not arrived yet. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminInvite } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { CardNotice } from "../../console/Card.tsx";
import { useAdminAction } from '../../console/hooks.ts';

export function InvitationsSection({
  isOwner = false,
  onError,
}: {
  /** Roles are the owner's to give, by invitation too: the server refuses anyone else. */
  isOwner?: boolean;
  onError: (message: string | null) => void;
}) {
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"member" | "admin" | "guest">("member");
  /** A guest's channels: the rooms the invitation lets them into, and all they see. */
  const [guestChannels, setGuestChannels] = useState<string[]>([]);
  const channels = useStore((s) => s.channels);
  // What this admin may offer a guest: public channels, and private ones they are in.
  const offerable = Object.values(channels)
    .filter(
      (channel) =>
        !channel.archivedAt &&
        (channel.kind === "public" || (channel.kind === "private" && channel.membership)),
    )
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
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
              channelIds: role === "guest" ? guestChannels : undefined,
            });
            setLink(created.url);
            setEmailed(created.emailed ?? null);
            setEmail("");
            setGuestChannels([]);
          });
        }}
      >
        <label className="field">
          <span className="field-label">{role === "guest" ? "Email" : "Email (optional)"}</span>
          <input
            className="input"
            type="email"
            value={email}
            required={role === "guest"}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={role === "guest" ? "A guest is invited by address" : "Leave blank for a shareable link"}
          />
        </label>
        <label className="field">
          <span className="field-label">Joins as</span>
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "admin" | "guest")}
          >
            <option value="member">member</option>
            <option value="guest">guest</option>
            {isOwner && <option value="admin">admin</option>}
          </select>
        </label>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={role === "guest" && guestChannels.length === 0}
        >
          Create invitation
        </button>
      </form>

      {role === "guest" && (
        <fieldset className="guest-channels">
          <legend className="field-label">Channels the guest may see</legend>
          <p className="pref-hint">
            A guest sees these channels and the people in them — no others, no directory,
            no agents.
          </p>
          {offerable.map((channel) => (
            <label key={channel.id} className="guest-channel">
              <input
                type="checkbox"
                checked={guestChannels.includes(channel.id)}
                onChange={(e) =>
                  setGuestChannels((chosen) =>
                    e.target.checked
                      ? [...chosen, channel.id]
                      : chosen.filter((id) => id !== channel.id),
                  )
                }
              />
              <span>
                #{channel.name}
                {channel.kind === "private" ? " · private" : ""}
              </span>
            </label>
          ))}
        </fieldset>
      )}

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
