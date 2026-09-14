/** People: everyone here, the groups they are in, who is invited, and every account.
 *
 * Four pages became one, for the reason You folded profile, preferences and
 * notifications together: the only way to find out which of the four held the person
 * you were after was to open all four. Members leads because it is the roster; the
 * other three are what happens to a person before they arrive (invitations), how they
 * are addressed as a team (groups), and the owner's view across the whole server
 * (accounts), which stays the owner's alone.
 *
 * A detail id means one member's page — `/admin/members/:id` — and only Members gets
 * it: a member's id is not a group's, and handing it to every part would open three
 * wrong things. Groups keep their own detail route at `/admin/groups/:id`.
 */

import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { PeopleSection } from "./PeopleSection.tsx";
import { GroupsSection } from "./GroupsSection.tsx";
import { InvitationsSection } from "./InvitationsSection.tsx";
import { AccountsSection } from "./AccountsSection.tsx";

export function PeopleHub(props: ConsoleSectionProps) {
  if (props.detailId) return <PeopleSection {...props} />;

  return (
    <section className="you-page">
      <div className="you-part">
        <h2 className="you-part-title">Members</h2>
        <p className="pref-hint m-0">Everyone here, and what they can do.</p>
        <PeopleSection {...props} />
      </div>

      <div className="you-part">
        <h2 className="you-part-title">User groups</h2>
        <p className="pref-hint m-0">
          Teams that can be mentioned as one name, like @platform-team.
        </p>
        <GroupsSection {...props} />
      </div>

      <div className="you-part">
        <h2 className="you-part-title">Invitations</h2>
        <p className="pref-hint m-0">Who has been invited, and who has not arrived yet.</p>
        <InvitationsSection {...props} />
      </div>

      {props.isOwner && (
        <div className="you-part">
          <h2 className="you-part-title">Accounts</h2>
          <p className="pref-hint m-0">Every account on this server — the owner's view.</p>
          <AccountsSection {...props} />
        </div>
      )}
    </section>
  );
}
