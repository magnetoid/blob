/** Everyone in the workspace, and what they can do. */

import { useCallback, useEffect, useState } from "react";
import { api, type AdminUser } from "../../../lib/api.ts";
import { useStore } from "../../../lib/store.ts";
import { Avatar } from "../../../components/Avatar.tsx";
import { ConfirmDialog } from "../../../components/ConfirmDialog.tsx";
import { DialogPresence } from "../../../components/Dialog.tsx";
import { SearchIcon } from "../../../components/Icon.tsx";
import { Badge } from "../../../components/ui/badge.tsx";
import { Button } from "../../../components/ui/button.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../components/ui/input-group.tsx";
import {
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../../../components/ui/item.tsx";
import { NativeSelect, NativeSelectOption } from "../../../components/ui/native-select.tsx";
import { formatRelative } from "../../messages/messageFormatting.ts";
import { CardNotice, CardRow, CardRows } from "../../console/Card.tsx";
import { CopyField } from "../../console/CopyField.tsx";
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
      <InputGroup className="max-w-xs">
        <InputGroupAddon>
          <SearchIcon size="sm" />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or email"
          aria-label="Search people"
        />
      </InputGroup>

      {loading && users.length === 0 ? (
        <CardNotice>Loading…</CardNotice>
      ) : users.length === 0 ? (
        <CardNotice>Nobody matched “{query}”.</CardNotice>
      ) : (
        // A list, not a table: these rows have no cells to be a table's rows, and axe
        // reads `role="row"` without them as broken structure (critical, in CI's scan).
        <CardRows>
          {users.map((user) => (
            <CardRow key={user.id}>
              {/* A person who is off goes grey and their badge says why, rather than the
                  whole row being dimmed, which took its meta line below readable. */}
              <ItemMedia className={user.deactivatedAt ? "opacity-60" : undefined}>
                <Avatar
                  user={{ displayName: user.displayName, avatarUrl: null }}
                  size="lg"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle className={user.deactivatedAt ? "text-muted-foreground" : undefined}>
                  {user.displayName}
                  {user.role !== "member" && <Badge variant="outline">{user.role}</Badge>}
                  {user.placeholder ? (
                    // Brought over by an import (ADR 0042): somebody who can still be
                    // invited has not joined yet; an app, or somebody Slack gave no
                    // address, is a name on old messages and nothing more.
                    <Badge variant="secondary">
                      {user.invitable ? 'not joined yet' : 'from Slack'}
                    </Badge>
                  ) : (
                    user.deactivatedAt && <Badge variant="secondary">deactivated</Badge>
                  )}
                  {user.twoStep && !user.deactivatedAt && (
                    <Badge variant="secondary" title="Signs in with a password and a passkey">
                      two-step
                    </Badge>
                  )}
                </ItemTitle>
                <ItemDescription>
                  {user.placeholder && !user.invitable ? "no address" : user.email} ·{" "}
                  {user.messageCount} messages · {user.channelCount} channels
                  {user.lastSeenAt
                    ? ` · seen ${formatRelative(user.lastSeenAt)}`
                    : " · never seen"}
                </ItemDescription>
              </ItemContent>

              <ItemActions>
                {isOwner &&
                  user.id !== currentUser?.id &&
                  !user.deactivatedAt && (
                    <NativeSelect
                      size="sm"
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
                      <NativeSelectOption value="guest">guest</NativeSelectOption>
                      <NativeSelectOption value="member">member</NativeSelectOption>
                      <NativeSelectOption value="admin">admin</NativeSelectOption>
                      <NativeSelectOption value="owner">owner</NativeSelectOption>
                    </NativeSelect>
                  )}
                {!user.deactivatedAt && mayActOn(user) && (
                  <Button
                    variant="ghost"
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
                  </Button>
                )}
                {!user.deactivatedAt &&
                  user.twoStep &&
                  user.id !== currentUser?.id &&
                  mayActOn(user) && (
                    <Button
                      variant="ghost"
                      aria-label={`End two-step for ${user.displayName}: stop asking for a passkey`}
                      title="For someone who lost the devices their passkeys were on"
                      onClick={() => setEndingTwoStep(user)}
                    >
                      End two-step
                    </Button>
                  )}
                {!user.deactivatedAt &&
                  user.sessionCount > 0 &&
                  (user.id === currentUser?.id || mayActOn(user)) && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void act(() => api.admin.revokeSessions(user.id))
                    }
                    // The visible words first, so a voice command that says what it sees
                    // ("click Sign out") finds the button — WCAG 2.5.3.
                    aria-label={`Sign out ${user.displayName}: ${sessions(user.sessionCount)}`}
                    title={`Sign out of ${sessions(user.sessionCount)}`}
                  >
                    Sign out
                  </Button>
                )}
                {user.placeholder ? (
                  user.invitable && (
                    <Button
                      variant="outline"
                      aria-label={`Invite ${user.displayName}`}
                      onClick={() =>
                        void act(() => api.auth.createInvite({ email: user.email }))
                      }
                    >
                      Invite
                    </Button>
                  )
                ) : user.deactivatedAt ? (
                  <Button
                    variant="outline"
                    aria-label={`Reactivate ${user.displayName}`}
                    onClick={() =>
                      void act(() => api.admin.reactivate(user.id))
                    }
                  >
                    Reactivate
                  </Button>
                ) : (
                  user.role !== "owner" &&
                  user.id !== currentUser?.id && (
                    <Button
                      variant="outline"
                      aria-label={`Deactivate ${user.displayName}`}
                      onClick={() => setDeactivating(user)}
                    >
                      Deactivate
                    </Button>
                  )
                )}
              </ItemActions>
            </CardRow>
          ))}
        </CardRows>
      )}

      {resetLink && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            For {resetLink.name}, good for an hour.
          </p>
          <CopyField
            label={`Password reset link for ${resetLink.name}`}
            value={resetLink.url}
          />
          <Button variant="ghost" className="self-start" onClick={() => setResetLink(null)}>
            Done
          </Button>
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
