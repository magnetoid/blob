/** Initials avatar with optional presence dot. */

import type { PresenceState, User, UserKind } from "@blob/shared";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

interface Props {
  /**
   * `kind` is optional because most callers hold a partial user — a reaction's author,
   * a search hit — and widening the type would mean inventing a kind at nineteen call
   * sites. Absent means unknown, and unknown is drawn as neither: claiming "human"
   * where nobody said so is the one wrong answer, since an agent that reads as a
   * person is exactly what the marking exists to prevent.
   */
  user: (Pick<User, "displayName" | "avatarUrl"> & { kind?: UserKind }) | undefined;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ user, size = "md" }: Props) {
  const name = user?.displayName ?? "?";
  return (
    <span className="avatar" data-size={size} data-kind={user?.kind} title={name}>
      {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials(name)}
    </span>
  );
}

export function AvatarWithPresence({
  user,
  state,
}: {
  user: Pick<User, "displayName" | "avatarUrl"> | undefined;
  state: PresenceState;
}) {
  return (
    <span className="dm-avatar">
      <Avatar user={user} size="sm" />
      <span className="presence-dot" data-state={state} />
    </span>
  );
}
