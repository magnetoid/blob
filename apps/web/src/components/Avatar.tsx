/**
 * A person's or an agent's avatar, with an optional presence dot.
 *
 * shadcn's avatar (`ui/avatar`), which is Base UI's, wearing Meadow: a rounded square in a
 * tone chosen from the name, one letter, a photo over it when there is one. The class
 * names `avatar` and `dm-avatar` style nothing here; they are what the contextual legacy
 * rules — faces overlapped in a header, a collapsed sidebar, an inactive console row —
 * still select.
 */

import type { PresenceState, User, UserKind } from "@blob/shared";
import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from "./ui/avatar.tsx";

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

/**
 * The box: 30px, 20px in a row (`sm`), 36px leading a message (`lg`). A rounded square,
 * never a circle — circles are reserved for status dots, so a round thing next to a name
 * can only ever mean presence. That is also why shadcn's ring goes: it is an `::after`
 * drawn round, and it would sit as a circle on a square.
 */
const ROOT = [
  "avatar size-[30px] items-center justify-center overflow-hidden rounded-[10px] font-bold leading-none after:hidden",
  "data-[size=sm]:size-[20px] data-[size=sm]:rounded-[7px]",
  "data-[size=lg]:size-[36px]",
].join(" ");

/**
 * Sage is the default and clay the other human tone (clay on clay-text is 6.5:1 in light,
 * 7.6:1 in dark). An agent is iris, whatever its name would have picked: a bot is a real
 * users row (ADR 0005) that posts through the same path a person does, and would land in
 * the list looking like one. Reserved, and not themeable.
 */
const TONES = {
  sage: "bg-(--avatar-bg) text-(--blob-accent)",
  clay: "bg-(--clay) text-(--clay-text)",
  agent: "bg-[conic-gradient(from_200deg,var(--iris-strong),var(--iris-soft),var(--iris))] text-white",
} as const;

/**
 * The letter, in the box's colour rather than shadcn's muted chip — one letter now, so it
 * can be read: two at 30px were 10.5px.
 */
const INITIALS = [
  "avatar-initials rounded-none bg-transparent text-inherit text-[13px] leading-none",
  "group-data-[size=sm]/avatar:text-[10px] group-data-[size=lg]/avatar:text-[15px]",
].join(" ");

/**
 * The photo sits over the letter and fades in once it has loaded; the letter leaves as it
 * does, so a photo with transparency never shows it through. A photo that never loads
 * leaves the letter, where it used to leave an empty square.
 *
 * `keepMounted` is what keeps the message list still. Base UI's default mounts the image
 * only once it has loaded, so even a photo the browser already holds would arrive through
 * `data-starting-style` and fade in — on every scroll, since the list remounts its rows.
 * Kept mounted, the image reads its own `complete` in the commit that mounts it, a cached
 * one is marked loaded before the first paint and skips the starting frame, and the letter
 * is gone by then too. Only a photo that had to be fetched fades.
 */
const PHOTO = [
  "avatar-photo absolute inset-0 rounded-[inherit]",
  "transition-opacity duration-(--dur-open) ease-(--blob-ease-out)",
  "data-loading:opacity-0 data-error:opacity-0 data-starting-style:opacity-0",
].join(" ");

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
  const named = tone(name);
  return (
    <AvatarRoot
      className={`${ROOT} ${TONES[user?.kind === "bot" ? "agent" : named]}`}
      // Blob's three size names, on the attribute shadcn's own sizes read: it is set after
      // the part's, and the classes above restate all three.
      data-size={size}
      data-kind={user?.kind}
      data-tone={named}
      title={name}
    >
      {user?.avatarUrl && (
        // Keyed by the address, so a new photo starts from loading rather than inheriting
        // the old one's status.
        <AvatarImage
          key={user.avatarUrl}
          src={user.avatarUrl}
          alt=""
          keepMounted
          className={PHOTO}
        />
      )}
      {/* Decoration while a photo is there or coming: the name is the avatar's title. */}
      <AvatarFallback className={INITIALS} aria-hidden={user?.avatarUrl ? true : undefined}>
        {initial(name)}
      </AvatarFallback>
    </AvatarRoot>
  );
}

/** The sidebar's avatar, with whether the person is here pinned to its corner. The dot is
 *  legacy markup it shares with the account menu (`.presence-dot`). */
export function AvatarWithPresence({
  user,
  state,
}: {
  user: Pick<User, "displayName" | "avatarUrl"> | undefined;
  state: PresenceState;
}) {
  return (
    <span className="dm-avatar relative size-[20px] flex-none">
      <Avatar user={user} size="sm" />
      <span className="presence-dot" data-state={state} />
    </span>
  );
}
