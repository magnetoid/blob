/** You: who the workspace sees, how Blob looks, and when it may interrupt you.
 *
 * These were three screens — a `/profile` route of its own, Preferences, and
 * Notifications — and the split never held. Your display name is a preference by any
 * ordinary reading of the word, "quiet hours" is not a different kind of setting from
 * "density", and the only way to find out which of the three held the control you
 * wanted was to open all three. One page, in the order somebody sets them up: who you
 * are, how it looks, when it speaks — each part a card, drawn by the part itself so that
 * its Save can sit in its own footer.
 */

import type { ConsoleSectionProps } from "../console/ConsoleShell.tsx";
import { ProfileCard } from "./ProfileCard.tsx";
import { PreferencesCard } from "./PreferencesCard.tsx";
import { NotificationsCard } from "./NotificationsCard.tsx";
import { ExportsCard } from "../console/ExportsCard.tsx";
import { AccountCard } from "./AccountCard.tsx";
import { useStore } from "../../lib/store.ts";

export function YouSection(props: ConsoleSectionProps) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return null;

  return (
    <div className="console-stack">
      <p className="pref-hint m-0">
        Signed in as {currentUser.displayName} · {currentUser.email}
      </p>
      <ProfileCard />
      <PreferencesCard />
      <NotificationsCard />
      {/* Taking your data with you (M3 · B4): everything you are in, yours alone. */}
      <ExportsCard
        scope="personal"
        title="Export your data"
        description="Every conversation you are in — channels public and private, direct messages and group messages — with their messages, reactions and the list of their files, as a zip of JSON lines. Kept for a week."
      />
      <AccountCard {...props} />
    </div>
  );
}
