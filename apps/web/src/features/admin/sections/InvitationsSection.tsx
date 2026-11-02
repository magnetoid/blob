/** Who has been invited, and who has not arrived yet. */

import { useCallback, useEffect, useId, useState } from "react";
import { api, type AdminInvite } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { Alert, AlertDescription } from "../../../components/ui/alert.tsx";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { Checkbox } from "../../../components/ui/checkbox.tsx";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "../../../components/ui/field.tsx";
import { Input } from "../../../components/ui/input.tsx";
import { ItemActions, ItemContent, ItemDescription, ItemTitle } from "../../../components/ui/item.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { CardNotice, CardRow, CardRows } from "../../console/Card.tsx";
import { CopyField } from "../../console/CopyField.tsx";
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
  const fields = useId();

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
        className="flex flex-col gap-4"
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
        <div className="grid max-w-3xl gap-x-5 gap-y-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${fields}-email`}>
              {role === "guest" ? "Email" : "Email (optional)"}
            </FieldLabel>
            <Input
              id={`${fields}-email`}
              type="email"
              value={email}
              required={role === "guest"}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={role === "guest" ? "A guest is invited by address" : "Leave blank for a shareable link"}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${fields}-role`}>Joins as</FieldLabel>
            <NativeSelect
              id={`${fields}-role`}
              value={role}
              onChange={(e) => setRole(e.target.value as "member" | "admin" | "guest")}
            >
              <NativeSelectOption value="member">member</NativeSelectOption>
              <NativeSelectOption value="guest">guest</NativeSelectOption>
              {isOwner && <NativeSelectOption value="admin">admin</NativeSelectOption>}
            </NativeSelect>
          </Field>
        </div>

        {role === "guest" && (
          <FieldSet aria-describedby={`${fields}-guests`}>
            <FieldLegend variant="label">Channels the guest may see</FieldLegend>
            <FieldDescription id={`${fields}-guests`}>
              A guest sees these channels and the people in them — no others, no directory,
              no agents.
            </FieldDescription>
            {offerable.map((channel) => (
              <Field key={channel.id} orientation="horizontal">
                <Checkbox
                  id={`${fields}-${channel.id}`}
                  checked={guestChannels.includes(channel.id)}
                  onCheckedChange={(on) =>
                    setGuestChannels((chosen) =>
                      on
                        ? [...chosen, channel.id]
                        : chosen.filter((id) => id !== channel.id),
                    )
                  }
                />
                <FieldLabel htmlFor={`${fields}-${channel.id}`} className="font-normal">
                  #{channel.name}
                  {channel.kind === "private" ? " · private" : ""}
                </FieldLabel>
              </Field>
            ))}
          </FieldSet>
        )}

        <Button
          className="self-start"
          type="submit"
          disabled={role === "guest" && guestChannels.length === 0}
        >
          Create invitation
        </Button>
      </form>

      {link && emailed === false && (
        <Alert variant="destructive">
          <AlertDescription>
            The email did not go out — this server cannot reach a mail server, so the link
            below is the only copy. Send it to them yourself, or set SMTP_HOST and
            MAIL_FROM and try again.
          </AlertDescription>
        </Alert>
      )}
      {link && emailed === true && (
        <p className="text-sm text-muted-foreground">
          Emailed. The link is here too, in case it does not arrive.
        </p>
      )}

      {link && <CopyField label="Invitation link" value={link} />}

      {invites.length === 0 ? (
        <CardNotice>No invitations yet.</CardNotice>
      ) : (
        <CardRows>
          {invites.map((invite) => (
            <CardRow key={invite.id}>
              <ItemContent>
                {/* An invitation that is over goes grey and its badge says how; a pending
                    one is the one to read. */}
                <ItemTitle className={invite.status !== "pending" ? "text-muted-foreground" : undefined}>
                  {invite.email ?? "Shareable link"}
                  <Badge variant={invite.status === "pending" ? "secondary" : "outline"}>
                    {invite.status}
                  </Badge>
                  {invite.role !== "member" && <Badge variant="outline">{invite.role}</Badge>}
                </ItemTitle>
                <ItemDescription>
                  Created by {invite.createdByName ?? "someone"}{" "}
                  {formatRelative(invite.createdAt)}
                  {invite.acceptedByName &&
                    ` · accepted by ${invite.acceptedByName}`}
                </ItemDescription>
              </ItemContent>
              {invite.status === "pending" && (
                <ItemActions>
                  <Button
                    variant="outline"
                    aria-label={`Revoke the invitation to ${invite.email ?? "a shareable link"}`}
                    onClick={() =>
                      void act(() => api.admin.revokeInvite(invite.id))
                    }
                  >
                    Revoke
                  </Button>
                </ItemActions>
              )}
            </CardRow>
          ))}
        </CardRows>
      )}
    </>
  );
}
