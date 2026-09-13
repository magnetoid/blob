/** You: who the workspace sees, how Blob looks, and when it may interrupt you.
 *
 * These were three screens — a `/profile` route of its own, Preferences, and
 * Notifications — and the split never held. Your display name is a preference by any
 * ordinary reading of the word, "quiet hours" is not a different kind of setting from
 * "density", and the only way to find out which of the three held the control you
 * wanted was to open all three. One page, three parts, in the order somebody sets them
 * up: who you are, how it looks, when it speaks.
 */

import type { ConsoleSectionProps } from "../console/ConsoleShell.tsx";
import { ProfileCard } from "./ProfileCard.tsx";
import { PreferencesCard } from "./PreferencesCard.tsx";
import { NotificationsCard } from "./NotificationsCard.tsx";
import { AccountCard } from "./AccountCard.tsx";
import { useStore } from "../../lib/store.ts";

export function YouSection(props: ConsoleSectionProps) {
  const currentUser = useStore((s) => s.currentUser);
  if (!currentUser) return null;

  return (
    <section className="you-page">
      <p className="pref-hint m-0">
        Signed in as {currentUser.displayName} · {currentUser.email}
      </p>

      <div className="you-part">
        <h2 className="you-part-title">Profile</h2>
        <p className="pref-hint m-0">What other people see on your messages.</p>
        <ProfileCard />
      </div>

      <div className="you-part">
        <h2 className="you-part-title">Preferences</h2>
        <p className="pref-hint m-0">
          How Blob looks and behaves, on this device and everywhere.
        </p>
        <PreferencesCard />
      </div>

      <div className="you-part">
        <h2 className="you-part-title">Notifications</h2>
        <p className="pref-hint m-0">
          When Blob is allowed to interrupt you, and what counts as urgent.
        </p>
        <NotificationsCard />
      </div>

      <div className="you-part">
        <h2 className="you-part-title">Account</h2>
        <p className="pref-hint m-0">
          The devices you are signed in on, and the way out.
        </p>
        <AccountCard {...props} />
      </div>
    </section>
  );
}
