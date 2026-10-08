/** Initial avatar with optional presence dot. */

import type { PresenceState, User, UserKind } from "@blob/shared";
import { revealIfCached, revealOnLoad } from "../lib/imageReveal.ts";

/**
 * One letter, as Meadow's rules sheet draws a person: "flat initial avatar in clay or
 * sage". Two letters at 9px — the sidebar's size — were a smudge, and the tone below
 * does the work a second letter did of telling two A's apart. By code point, so a name
 * that starts with an emoji or an accented capital keeps the whole character.
 */
function initial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : "?";
}

/**
 * Clay or sage — Meadow's two human tones — chosen from the name, so a person is the
 * same colour in the sidebar, a message, a reaction and a search hit, including the
 * places that hold only a name and no id. FNV-1a; the low bit is plenty for a choice of
 * two, and no alphabet split, which would paint most of a team one colour because
 * initials cluster.
 */
function tone(name: string): "clay" | "sage" {
  let hash = 0x811c9dc5;
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash & 1) === 1 ? "clay" : "sage";
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
    <span
      className="avatar"
      data-size={size}
      data-kind={user?.kind}
      // An agent is drawn in iris whatever this says (`.avatar[data-kind='bot']`).
      data-tone={tone(name)}
      title={name}
    >
      {user?.avatarUrl ? (
        // The photo over the initials rather than instead of them: they are what shows
        // while it loads, and what stays if it never does — a broken photo used to leave
        // an empty square. Keyed by the address, so a new photo fades in as a new image.
        <>
          <img
            key={user.avatarUrl}
            src={user.avatarUrl}
            alt=""
            ref={revealIfCached}
            onLoad={revealOnLoad}
          />
          <span className="avatar-initials" aria-hidden="true">
            {initial(name)}
          </span>
        </>
      ) : (
        initial(name)
      )}
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
