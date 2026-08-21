/** Initials avatar with optional presence dot. */

import type { PresenceState, User } from "@blob/shared";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

interface Props {
  user: Pick<User, "displayName" | "avatarUrl"> | undefined;
  size?: "sm" | "md" | "lg";
}

export function Avatar({ user, size = "md" }: Props) {
  const name = user?.displayName ?? "?";
  return (
    <span className="avatar" data-size={size} title={name}>
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
