/** People: everyone here, the groups they are in, who is invited, and every account.
 *
 * Four pages became one, for the reason You folded profile, preferences and
 * notifications together: the only way to find out which of the four held the person
 * you were after was to open all four. Members leads because it is the roster; the
 * other three are what happens to a person before they arrive (invitations), how they
 * are addressed as a team (groups), and the owner's view across the whole server
 * (accounts), which stays the owner's alone.
 *
 * Each part is a card, and the card is drawn here rather than by the part: the parts are
 * also reached alone by their old URLs, where AdminConsole frames them the same way.
 *
 * A detail id means one member's page — `/admin/members/:id` — and only Members gets
 * it: a member's id is not a group's, and handing it to every part would open three
 * wrong things. Groups keep their own detail route at `/admin/groups/:id`.
 */

import type { ConsoleSectionProps } from "../../console/ConsoleShell.tsx";
import { Card } from "../../console/Card.tsx";
import { PeopleSection } from "./PeopleSection.tsx";
import { GroupsSection } from "./GroupsSection.tsx";
import { InvitationsSection } from "./InvitationsSection.tsx";
import { AccountsSection } from "./AccountsSection.tsx";

export function PeopleHub(props: ConsoleSectionProps) {
  if (props.detailId) {
    return (
      <div className="console-stack">
        <Card>
          <PeopleSection {...props} />
        </Card>
      </div>
    );
  }

  return (
    <div className="console-stack">
      <Card title="Members" description="Everyone here, and what they can do.">
        <PeopleSection {...props} />
      </Card>

      <Card
        title="User groups"
        description="Teams that can be mentioned as one name, like @platform-team."
      >
        <GroupsSection {...props} />
      </Card>

      <Card
        title="Invitations"
        description="Who has been invited, and who has not arrived yet."
      >
        <InvitationsSection {...props} />
      </Card>

      {props.isOwner && (
        <Card
          title="Accounts"
          description="Every account on this server — the owner's view."
        >
          <AccountsSection {...props} />
        </Card>
      )}
    </div>
  );
}
