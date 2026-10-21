"""Who may see what, as SQL — for the rules more than one layer has to say the same way.

A guest (ADR 0034) is in a workspace for the channels they were invited to and nothing
else. Two fragments say that, and every query that lists channels or people to a viewer
uses them rather than its own wording of it: the services that answer REST, and the
socket that answers presence, which may not import the services.
"""

from __future__ import annotations

#: The viewer — bound as `:user_id` — is a guest. "Public" is public to the workspace's
#: members, not to its guests: every query that lets a public channel open itself to
#: somebody who has not joined it says `AND NOT` this beside its `kind = 'public'`.
VIEWER_IS_GUEST = (
    "EXISTS (SELECT 1 FROM users viewer WHERE viewer.id = :user_id AND viewer.role = 'guest')"
)

#: The people a guest — bound as `:viewer` — may know anything about: themselves, and
#: whoever shares a channel with them. For a query over `users u`.
GUEST_SEES = """(
    u.id = :viewer
    OR EXISTS (
        SELECT 1 FROM channel_members mine
          JOIN channel_members theirs ON theirs.channel_id = mine.channel_id
         WHERE mine.user_id = :viewer AND theirs.user_id = u.id
    )
)"""

__all__ = ["GUEST_SEES", "VIEWER_IS_GUEST"]
