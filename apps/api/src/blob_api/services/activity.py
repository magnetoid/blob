"""What happened to you: mentions of you, and reactions to what you wrote.

Slack calls this Activity and people live in it. Blob had the halves scattered — a
mention bumped a per-channel badge and then existed nowhere you could look at it, and a
reaction to your message left no trace at all outside the message itself, so somebody
answering you with a 👍 or a ✅ in a channel you had scrolled past was invisible.

Two sources, one list, ordered by when they happened. A mention's moment is the message's
`created_at`; a reaction's is the reaction's own. Both are keyset-paged on
`(at, message_id, actor_id)` — the triple, because two people can react to the same
message in the same instant and a pair would drop one of them at a page boundary.

Membership is the boundary, in the statement, as it is in search: you see a mention or a
reaction only in a channel you are still in. Muting changes what is *noise*, not what is
addressed to you, so a direct mention in a channel you muted still appears here while
`@channel` in that same channel does not — muting is precisely the instruction not to be
told about the broadcast ones.

Mentions and reactions stay derived at read time for those rules. `activity_events` is
the write-side copy plus the generic row for reminders and recap, which have no message
column to derive from.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request
from ..lib.ids import new_id
from ..schemas.models import Message
from .serialize import MESSAGE_SELECT, to_message

#: What the list can be narrowed to. `all` is everything the caller is allowed to see.
KINDS = ("all", "mention", "reaction", "reminder", "recap")
#: Stored extra kinds — not derived from messages/reactions.
STORED_KINDS = ("reminder", "recap")


@dataclass(slots=True)
class ActivityCursor:
    """Where the previous page stopped: the sort key it stopped on, all three parts."""

    at: datetime
    message_id: str
    actor_id: str

    #: Digits and tildes only, so the cursor survives a query string untouched. An ISO
    #: timestamp would not: its `+00:00` decodes as a space and the page after it is a
    #: 400 that looks like a bug in paging. Microseconds are kept exactly — going
    #: through a float epoch loses the last one, and the comparison here is strict.
    FORMAT = "%Y%m%d%H%M%S%f"

    def encode(self) -> str:
        stamp = self.at.astimezone(UTC).strftime(ActivityCursor.FORMAT)
        return f"{stamp}~{self.message_id}~{self.actor_id}"

    @staticmethod
    def decode(raw: str) -> ActivityCursor:
        stamp, _, rest = raw.partition("~")
        message_id, _, actor_id = rest.partition("~")
        try:
            return ActivityCursor(
                at=datetime.strptime(stamp, ActivityCursor.FORMAT).replace(tzinfo=UTC),
                message_id=str(UUID(message_id)),
                actor_id=str(UUID(actor_id)),
            )
        except ValueError:
            # Opaque, and always ours. A malformed one is a bug or a hand-edited URL.
            raise bad_request("That activity cursor is not one we issued.") from None


@dataclass(slots=True)
class ActivityItem:
    #: "mention", "reaction", "reminder", or "recap".
    kind: str
    at: datetime
    message: Message
    #: Who did it — the person who mentioned you, or who reacted.
    actor_id: str | None
    #: The reaction's emoji; None for a mention.
    emoji: str | None


async def record(
    session: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    kind: str,
    actor_id: str | None,
    channel_id: str | None,
    message_id: str | None,
    emoji: str | None = None,
    payload: dict[str, Any] | None = None,
) -> None:
    """Write one event. Idempotent on (user, kind, message, actor, emoji)."""

    # Mentions and reactions to yourself are not activity. A reminder is.
    if kind in ("mention", "reaction") and user_id == actor_id:
        return
    await session.execute(
        text(
            """
            INSERT INTO activity_events (
                id, workspace_id, user_id, kind, actor_id, channel_id,
                message_id, emoji, payload)
            SELECT :id, :workspace_id, :user_id, :kind, :actor_id, :channel_id,
                   :message_id, :emoji, cast(:payload AS jsonb)
             WHERE NOT EXISTS (
                 SELECT 1 FROM activity_events
                  WHERE user_id = cast(:user_id AS uuid)
                    AND kind = :kind
                    AND message_id IS NOT DISTINCT FROM cast(:message_id AS uuid)
                    AND actor_id IS NOT DISTINCT FROM cast(:actor_id AS uuid)
                    AND COALESCE(emoji, '') = COALESCE(:emoji, '')
             )
            """
        ),
        {
            "id": new_id(),
            "workspace_id": workspace_id,
            "user_id": user_id,
            "kind": kind,
            "actor_id": actor_id,
            "channel_id": channel_id,
            "message_id": message_id,
            "emoji": emoji,
            "payload": json.dumps(payload or {}),
        },
    )


async def record_direct_mentions(
    session: AsyncSession,
    *,
    workspace_id: str,
    channel_id: str,
    message_id: str,
    actor_id: str,
    user_ids: list[str],
) -> None:
    """Persist a mention row for each named person except the author."""

    for user_id in user_ids:
        await record(
            session,
            workspace_id=workspace_id,
            user_id=user_id,
            kind="mention",
            actor_id=actor_id,
            channel_id=channel_id,
            message_id=message_id,
        )


async def record_reaction(
    session: AsyncSession,
    *,
    message_id: str,
    actor_id: str,
    emoji: str,
) -> None:
    """Persist a reaction event for the author, when somebody else reacted."""

    row = (
        await session.execute(
            text(
                """
                SELECT workspace_id, channel_id, author_id
                  FROM messages
                 WHERE id = :id AND deleted_at IS NULL
                """
            ),
            {"id": message_id},
        )
    ).fetchone()
    if row is None or row.author_id is None:
        return
    await record(
        session,
        workspace_id=str(row.workspace_id),
        user_id=str(row.author_id),
        kind="reaction",
        actor_id=actor_id,
        channel_id=str(row.channel_id),
        message_id=message_id,
        emoji=emoji,
    )


_FEED = f"""
WITH my_groups AS (
  SELECT group_id FROM user_group_members WHERE user_id = cast(:user_id AS uuid)
),
events AS (
  -- Someone named you. A direct mention survives a muted channel; a broadcast one does
  -- not, because that is what muting the channel asked for.
  SELECT m.created_at AS at,
         'mention'::text AS kind,
         m.id AS message_id,
         m.author_id AS actor_id,
         NULL::text AS emoji
    FROM messages m
    JOIN channel_members cm
      ON cm.channel_id = m.channel_id AND cm.user_id = cast(:user_id AS uuid)
   WHERE m.workspace_id = cast(:workspace_id AS uuid)
     AND m.deleted_at IS NULL
     AND m.author_id IS DISTINCT FROM cast(:user_id AS uuid)
     AND (:kind = 'all' OR :kind = 'mention')
     AND (cast(:user_id AS uuid) = ANY(m.mention_user_ids)
          OR (cm.notify_level <> 'none'
              AND (m.mentions_everyone
                   OR EXISTS (SELECT 1 FROM my_groups g
                               WHERE g.group_id = ANY(m.mention_group_ids)))))
  UNION ALL
  -- Someone reacted to something you wrote.
  SELECT r.created_at AS at,
         'reaction'::text AS kind,
         m.id AS message_id,
         r.user_id AS actor_id,
         r.emoji AS emoji
    FROM reactions r
    JOIN messages m ON m.id = r.message_id
    JOIN channel_members cm
      ON cm.channel_id = m.channel_id AND cm.user_id = cast(:user_id AS uuid)
   WHERE m.workspace_id = cast(:workspace_id AS uuid)
     AND m.deleted_at IS NULL
     AND m.author_id = cast(:user_id AS uuid)
     AND r.user_id <> cast(:user_id AS uuid)
     AND (:kind = 'all' OR :kind = 'reaction')
  UNION ALL
  -- Stored extra kinds (reminder, recap). Mentions/reactions stay derived above so
  -- mute/leave/delete keep their read-time meaning; dual-written copies of those
  -- kinds are not selected here.
  SELECT e.created_at AS at,
         e.kind AS kind,
         e.message_id AS message_id,
         e.actor_id AS actor_id,
         e.emoji AS emoji
    FROM activity_events e
    JOIN messages m ON m.id = e.message_id
    JOIN channel_members cm
      ON cm.channel_id = m.channel_id AND cm.user_id = cast(:user_id AS uuid)
   WHERE e.workspace_id = cast(:workspace_id AS uuid)
     AND e.user_id = cast(:user_id AS uuid)
     AND e.kind IN ('reminder', 'recap')
     AND m.deleted_at IS NULL
     AND (:kind = 'all' OR :kind = e.kind)
),
page AS (
  SELECT at, kind, message_id, actor_id, emoji
    FROM events
   -- Keyset, never OFFSET (ADR 0003). The triple is the whole sort key, so the
   -- comparison and the ordering agree exactly and no boundary drops a row.
   WHERE (cast(:cursor_at AS timestamptz) IS NULL
          OR (at, message_id, actor_id)
             < (cast(:cursor_at AS timestamptz),
                cast(:cursor_message_id AS uuid),
                cast(:cursor_actor_id AS uuid)))
   ORDER BY at DESC, message_id DESC, actor_id DESC
   LIMIT :limit
)
SELECT {MESSAGE_SELECT},
       p.at AS event_at,
       p.kind AS event_kind,
       p.actor_id AS event_actor_id,
       p.emoji AS event_emoji
  FROM page p
  JOIN messages m ON m.id = p.message_id
 ORDER BY p.at DESC, p.message_id DESC, p.actor_id DESC
"""


async def feed(
    session: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    kind: str = "all",
    limit: int = 30,
    cursor: ActivityCursor | None = None,
) -> tuple[list[ActivityItem], ActivityCursor | None]:
    rows: list[Any] = list(
        (
            await session.execute(
                text(_FEED),
                {
                    "workspace_id": workspace_id,
                    "user_id": user_id,
                    "kind": kind,
                    "limit": limit,
                    "cursor_at": cursor.at if cursor else None,
                    "cursor_message_id": cursor.message_id if cursor else None,
                    "cursor_actor_id": cursor.actor_id if cursor else None,
                },
            )
        ).fetchall()
    )
    items = [
        ActivityItem(
            kind=row.event_kind,
            at=row.event_at,
            message=to_message(row),
            actor_id=str(row.event_actor_id) if row.event_actor_id else None,
            emoji=row.event_emoji,
        )
        for row in rows
    ]
    # Only when the page is full: a short page is the end, and offering to continue past
    # it costs a request that can only come back empty.
    next_cursor = (
        ActivityCursor(
            at=rows[-1].event_at,
            message_id=str(rows[-1].id),
            actor_id=str(rows[-1].event_actor_id),
        )
        if len(rows) == limit and rows[-1].event_actor_id
        else None
    )
    return items, next_cursor


__all__ = [
    "KINDS",
    "STORED_KINDS",
    "ActivityCursor",
    "ActivityItem",
    "feed",
    "record",
    "record_direct_mentions",
    "record_reaction",
]
