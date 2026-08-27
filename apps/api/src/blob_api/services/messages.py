"""Message reads and writes.

The send path is the heart of the app, and the ordering in `send` is deliberate: persist
inside a transaction, then broadcast and enqueue *after* it commits. An event emitted
mid-transaction lets a client fetch a message the database hasn't committed yet.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, forbidden, not_found
from ..lib.ids import new_id
from ..lib.mentions import MentionTarget, mention_lookup_phrases, parse_mentions
from ..schemas.base import require_iso
from ..schemas.models import Message
from .serialize import MESSAGE_SELECT, to_message

#: Avatars shown on a thread's summary line.
FACEPILE_LIMIT = 5


#: "Leave it alone" for optional writes, distinct from "clear it" (None).
_UNSET: Any = object()


@dataclass(slots=True)
class ThreadUpdate:
    root_id: str
    channel_id: str
    reply_count: int
    reply_user_ids: list[str]
    last_reply_at: str | None

    def as_event(self) -> dict[str, Any]:
        return {
            "t": "thread.updated",
            "rootId": self.root_id,
            "channelId": self.channel_id,
            "replyCount": self.reply_count,
            "replyUserIds": self.reply_user_ids,
            "lastReplyAt": self.last_reply_at,
        }


@dataclass(slots=True)
class SendResult:
    message: Message
    #: False when this was a retry of an already-stored message.
    created: bool
    #: Present when the message was a thread reply; clients update the summary line.
    thread_update: ThreadUpdate | None


async def mention_targets(
    session: AsyncSession, workspace_id: str, body: str
) -> dict[str, MentionTarget]:
    """Lowercased handle → what it names, for handles this body could actually mention.

    One statement against `workspace_handles` rather than one against `users`, which is
    what makes a group mentionable at all — and what makes a collision impossible rather
    than merely unlikely, since a handle is owned by exactly one row there.

    The keys are `handle_lower`, which Postgres lowered. `parse_mentions` offers both
    Python's and Postgres' lowercasing on the lookup side to meet them; see the note
    there about "İ".
    """
    phrases = mention_lookup_phrases(body)
    if not phrases:
        return {}

    rows = (
        await session.execute(
            text(
                """
                SELECT handle_lower, user_id, group_id FROM workspace_handles
                 WHERE workspace_id = :ws
                   AND handle_lower = ANY(cast(:handles AS text[]))
                """
            ),
            {"ws": workspace_id, "handles": phrases},
        )
    ).fetchall()
    targets: dict[str, MentionTarget] = {}
    for row in rows:
        if row.group_id is not None:
            targets[row.handle_lower] = ("group", str(row.group_id))
        elif row.user_id is not None:
            targets[row.handle_lower] = ("user", str(row.user_id))
    return targets


async def send(
    session: AsyncSession,
    *,
    workspace_id: str,
    channel_id: str,
    author_id: str,
    body: str,
    client_msg_id: str,
    thread_root_id: str | None = None,
    also_in_channel: bool = False,
    attachment_ids: list[str] | None = None,
    kind: str = "user",
    plugin_id: str | None = None,
    #: Structured content beside the text. `body` stays the fallback and the only thing
    #: the search index reads, so a client that ignores blocks still shows something.
    blocks: list[dict[str, Any]] | None = None,
) -> SendResult:
    message_id = new_id()
    attachment_ids = attachment_ids or []
    mentions = parse_mentions(body, await mention_targets(session, workspace_id, body))

    if thread_root_id:
        root = (
            await session.execute(
                text("SELECT id, channel_id FROM messages WHERE id = :id"),
                {"id": thread_root_id},
            )
        ).fetchone()
        if root is None or root.channel_id != channel_id:
            raise not_found("That thread no longer exists.")

    # Idempotency: a retry of the same client_msg_id stores nothing new.
    inserted = (
        await session.execute(
            text(
                """
                INSERT INTO messages (
                  id, workspace_id, channel_id, author_id, kind, body, thread_root_id,
                  also_in_channel, mention_user_ids, mention_group_ids,
                  mentions_everyone, client_msg_id, plugin_id, blocks)
                VALUES (
                  :id, :ws, :channel_id, :author_id, :kind, :body, :thread_root_id,
                  :also_in_channel, cast(:mention_user_ids AS uuid[]),
                  cast(:mention_group_ids AS uuid[]), :mentions_everyone,
                  :client_msg_id, :plugin_id, cast(:blocks AS jsonb))
                ON CONFLICT (channel_id, author_id, client_msg_id) DO NOTHING
                RETURNING id
                """
            ),
            {
                "id": message_id,
                "ws": workspace_id,
                "channel_id": channel_id,
                "author_id": author_id,
                "kind": kind,
                "body": body,
                "thread_root_id": thread_root_id,
                "also_in_channel": also_in_channel,
                "mention_user_ids": mentions.user_ids,
                "mention_group_ids": mentions.group_ids,
                "mentions_everyone": mentions.everyone,
                "client_msg_id": client_msg_id,
                "plugin_id": plugin_id,
                "blocks": json.dumps(blocks) if blocks else None,
            },
        )
    ).fetchone()

    if inserted is None:
        existing = (
            await session.execute(
                text(
                    f"""
                    SELECT {MESSAGE_SELECT} FROM messages m
                     WHERE m.channel_id = :channel_id
                       AND m.author_id = :author_id
                       AND m.client_msg_id = :client_msg_id
                    """
                ),
                {
                    "channel_id": channel_id,
                    "author_id": author_id,
                    "client_msg_id": client_msg_id,
                },
            )
        ).fetchone()
        if existing is None:
            raise bad_request("Could not store that message.")
        return SendResult(message=to_message(existing), created=False, thread_update=None)

    if attachment_ids:
        # Only the uploader's own unbound attachments can be attached.
        bound = (
            await session.execute(
                text(
                    """
                    UPDATE attachments SET message_id = :message_id
                     WHERE id = ANY(cast(:ids AS uuid[]))
                       AND uploader_id = :uploader_id
                       AND message_id IS NULL
                    RETURNING id
                    """
                ),
                {
                    "message_id": message_id,
                    "ids": attachment_ids,
                    "uploader_id": author_id,
                },
            )
        ).fetchall()
        if len(bound) != len(attachment_ids):
            raise bad_request("One of those attachments is no longer available.")

    await session.execute(
        text("UPDATE channels SET last_message_id = :message_id WHERE id = :channel_id"),
        {"message_id": message_id, "channel_id": channel_id},
    )

    thread_update: ThreadUpdate | None = None
    if thread_root_id:
        root_row = (
            await session.execute(
                text(
                    """
                    UPDATE messages
                       SET reply_count = reply_count + 1,
                           last_reply_at = now(),
                           reply_user_ids = CASE
                             WHEN cast(:author_id AS uuid) = ANY(reply_user_ids)
                               THEN reply_user_ids
                             WHEN array_length(reply_user_ids, 1) >= :facepile
                               THEN reply_user_ids
                             ELSE array_append(reply_user_ids, cast(:author_id AS uuid))
                           END
                     WHERE id = :root_id
                    RETURNING reply_count, reply_user_ids, last_reply_at
                    """
                ),
                {
                    "root_id": thread_root_id,
                    "author_id": author_id,
                    "facepile": FACEPILE_LIMIT,
                },
            )
        ).fetchone()

        # Replying subscribes you to the thread, the way every chat app behaves.
        await session.execute(
            text(
                """
                INSERT INTO thread_subscriptions (user_id, thread_root_id, last_read_reply_id)
                VALUES (:user_id, :root_id, :message_id)
                ON CONFLICT (user_id, thread_root_id)
                  DO UPDATE SET last_read_reply_id = EXCLUDED.last_read_reply_id
                """
            ),
            {"user_id": author_id, "root_id": thread_root_id, "message_id": message_id},
        )

        if root_row is not None:
            from ..schemas.base import iso

            thread_update = ThreadUpdate(
                root_id=thread_root_id,
                channel_id=channel_id,
                reply_count=root_row.reply_count,
                reply_user_ids=list(root_row.reply_user_ids or []),
                last_reply_at=iso(root_row.last_reply_at),
            )

    # The author has, by definition, read their own message.
    await session.execute(
        text(
            """
            INSERT INTO read_states (user_id, channel_id, last_read_message_id, updated_at)
            VALUES (:user_id, :channel_id, :message_id, now())
            ON CONFLICT (user_id, channel_id) DO UPDATE
              SET last_read_message_id = GREATEST(
                    read_states.last_read_message_id, EXCLUDED.last_read_message_id),
                  updated_at = now()
            """
        ),
        {"user_id": author_id, "channel_id": channel_id, "message_id": message_id},
    )

    row = (
        await session.execute(
            text(f"SELECT {MESSAGE_SELECT} FROM messages m WHERE m.id = :id"),
            {"id": message_id},
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not store that message.")

    return SendResult(message=to_message(row), created=True, thread_update=thread_update)


async def history(
    session: AsyncSession,
    channel_id: str,
    *,
    before: str | None = None,
    after: str | None = None,
    around: str | None = None,
    limit: int = 50,
) -> tuple[list[Message], bool]:
    """Keyset pagination — never OFFSET. `(channel_id, id DESC)` covers all three modes."""
    limit = min(limit, 100)

    if around:
        # Jump-to-message: half a page either side of the target.
        half = limit // 2
        rows = (
            await session.execute(
                text(
                    f"""
                    (SELECT {MESSAGE_SELECT} FROM messages m
                      WHERE m.channel_id = :channel_id AND m.thread_root_id IS NULL
                        AND m.id <= :around
                      ORDER BY m.id DESC LIMIT :half)
                    UNION ALL
                    (SELECT {MESSAGE_SELECT} FROM messages m
                      WHERE m.channel_id = :channel_id AND m.thread_root_id IS NULL
                        AND m.id > :around
                      ORDER BY m.id ASC LIMIT :half)
                    """
                ),
                {"channel_id": channel_id, "around": around, "half": half},
            )
        ).fetchall()
        messages = sorted((to_message(row) for row in rows), key=lambda m: m.id)
        return messages, True

    forward = after is not None
    order = "ASC" if forward else "DESC"
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT} FROM messages m
                 WHERE m.channel_id = :channel_id
                   AND m.thread_root_id IS NULL
                   AND (cast(:before AS uuid) IS NULL OR m.id < cast(:before AS uuid))
                   AND (cast(:after AS uuid) IS NULL OR m.id > cast(:after AS uuid))
                 ORDER BY m.id {order}
                 LIMIT :limit
                """
            ),
            {
                "channel_id": channel_id,
                "before": before,
                "after": after,
                "limit": limit + 1,
            },
        )
    ).fetchall()

    has_more = len(rows) > limit
    page = rows[:limit] if has_more else rows
    messages = sorted((to_message(row) for row in page), key=lambda m: m.id)
    return messages, has_more


async def thread(session: AsyncSession, root_id: str) -> list[Message]:
    """A thread: its root plus every reply, oldest first.

    The LIMIT is a ceiling, not pagination — no real thread approaches it, and an
    unbounded read is how one pathological row set stalls a worker.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT} FROM messages m
                 WHERE m.id = :root_id OR m.thread_root_id = :root_id
                 ORDER BY m.id ASC
                 LIMIT 1000
                """
            ),
            {"root_id": root_id},
        )
    ).fetchall()
    return [to_message(row) for row in rows]


async def by_id(session: AsyncSession, message_id: str) -> Message | None:
    row = (
        await session.execute(
            text(f"SELECT {MESSAGE_SELECT} FROM messages m WHERE m.id = :id"),
            {"id": message_id},
        )
    ).fetchone()
    return to_message(row) if row else None


async def edit(
    session: AsyncSession, message_id: str, user_id: str, workspace_id: str, body: str
) -> Message:
    existing = (
        await session.execute(
            text("SELECT author_id, deleted_at FROM messages WHERE id = :id"),
            {"id": message_id},
        )
    ).fetchone()
    if existing is None or existing.deleted_at is not None:
        raise not_found("That message is gone.")
    if existing.author_id != user_id:
        raise forbidden("You can only edit your own messages.")

    mentions = parse_mentions(body, await mention_targets(session, workspace_id, body))
    await session.execute(
        text(
            """
            UPDATE messages
               SET body = :body, edited_at = now(),
                   mention_user_ids = cast(:mention_user_ids AS uuid[]),
                   mention_group_ids = cast(:mention_group_ids AS uuid[]),
                   mentions_everyone = :mentions_everyone
             WHERE id = :id
            """
        ),
        {
            "id": message_id,
            "body": body,
            "mention_user_ids": mentions.user_ids,
            "mention_group_ids": mentions.group_ids,
            "mentions_everyone": mentions.everyone,
        },
    )

    message = await by_id(session, message_id)
    if message is None:
        raise not_found("That message is gone.")
    return message


async def remove(
    session: AsyncSession, message_id: str, user_id: str, is_admin: bool
) -> tuple[str, str | None]:
    """Soft delete.

    The row survives because thread replies reference it; the body and attachments are
    cleared so nothing is recoverable through the API.
    """
    existing = (
        await session.execute(
            text(
                """
                SELECT author_id, channel_id, thread_root_id, deleted_at
                  FROM messages WHERE id = :id
                """
            ),
            {"id": message_id},
        )
    ).fetchone()
    if existing is None or existing.deleted_at is not None:
        raise not_found("That message is gone.")
    if existing.author_id != user_id and not is_admin:
        raise forbidden("You can only delete your own messages.")

    await session.execute(
        text(
            """
            UPDATE messages
               SET deleted_at = now(), body = '',
                   mention_user_ids = '{}', mention_group_ids = '{}',
                   mentions_everyone = false
             WHERE id = :id
            """
        ),
        {"id": message_id},
    )
    await session.execute(text("DELETE FROM reactions WHERE message_id = :id"), {"id": message_id})
    if existing.thread_root_id:
        await session.execute(
            text("UPDATE messages SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = :id"),
            {"id": existing.thread_root_id},
        )

    return existing.channel_id, existing.thread_root_id


async def set_pinned(session: AsyncSession, message_id: str, user_id: str, pinned: bool) -> Message:
    await session.execute(
        text(
            """
            UPDATE messages
               SET pinned_at = CASE WHEN :pinned THEN now() ELSE NULL END,
                   pinned_by = CASE WHEN :pinned THEN cast(:user_id AS uuid) ELSE NULL END
             WHERE id = :id AND deleted_at IS NULL
            """
        ),
        {"id": message_id, "pinned": pinned, "user_id": user_id},
    )
    message = await by_id(session, message_id)
    if message is None:
        raise not_found("That message is gone.")
    return message


async def list_pinned(session: AsyncSession, channel_id: str) -> list[Message]:
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT} FROM messages m
                 WHERE m.channel_id = :channel_id
                   AND m.pinned_at IS NOT NULL
                   AND m.deleted_at IS NULL
                 ORDER BY m.pinned_at DESC
                 LIMIT 200
                """
            ),
            {"channel_id": channel_id},
        )
    ).fetchall()
    return [to_message(row) for row in rows]


async def set_saved(session: AsyncSession, message_id: str, user_id: str, saved: bool) -> None:
    """Put a message aside, or take it back off the list.

    Idempotent in both directions by construction: the primary key is the pair, so a
    second save conflicts into nothing and a second unsave deletes nothing. Neither
    needs a read first, which is what keeps two taps on a phone from racing.
    """
    if saved:
        await session.execute(
            text(
                """
                INSERT INTO saved_items (user_id, message_id)
                VALUES (cast(:user_id AS uuid), cast(:message_id AS uuid))
                ON CONFLICT DO NOTHING
                """
            ),
            {"user_id": user_id, "message_id": message_id},
        )
    else:
        await session.execute(
            text(
                """
                DELETE FROM saved_items
                 WHERE user_id = cast(:user_id AS uuid)
                   AND message_id = cast(:message_id AS uuid)
                """
            ),
            {"user_id": user_id, "message_id": message_id},
        )


async def set_later(
    session: AsyncSession,
    message_id: str,
    user_id: str,
    *,
    state: str | None = None,
    remind_at: Any | None = _UNSET,
    note: Any = _UNSET,
) -> None:
    """Update a saved item's Later fields, saving it first if it wasn't.

    Upsert on purpose: "remind me about this" from a message's menu is one gesture,
    and requiring a separate save first would make the common path two. Setting a new
    reminder re-arms `reminded_at`, so "again in an hour" works on a fired one.
    """
    await session.execute(
        text(
            """
            INSERT INTO saved_items (user_id, message_id)
            VALUES (cast(:user_id AS uuid), cast(:message_id AS uuid))
            ON CONFLICT DO NOTHING
            """
        ),
        {"user_id": user_id, "message_id": message_id},
    )
    await session.execute(
        text(
            """
            UPDATE saved_items
               SET state = COALESCE(:state, state),
                   remind_at = CASE WHEN :has_remind THEN cast(:remind_at AS timestamptz)
                                    ELSE remind_at END,
                   reminded_at = CASE WHEN :has_remind THEN NULL ELSE reminded_at END,
                   note = CASE WHEN :has_note THEN :note ELSE note END
             WHERE user_id = cast(:user_id AS uuid)
               AND message_id = cast(:message_id AS uuid)
            """
        ),
        {
            "user_id": user_id,
            "message_id": message_id,
            "state": state,
            "has_remind": remind_at is not _UNSET,
            "remind_at": None if remind_at is _UNSET else remind_at,
            "has_note": note is not _UNSET,
            "note": None if note is _UNSET else note,
        },
    )


async def list_later(
    session: AsyncSession, user_id: str, *, state: str = "in_progress", limit: int = 100
) -> list[dict[str, Any]]:
    """The Later view: saved messages in one state, with their reminder metadata.

    Same security join as `list_saved` — leaving a channel takes its messages out of
    your list, and a saved row is not permission.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT},
                       s.state AS later_state, s.remind_at, s.note, s.reminded_at
                  FROM messages m
                  JOIN saved_items s
                    ON s.message_id = m.id AND s.user_id = :user_id
                  JOIN channel_members cm
                    ON cm.channel_id = m.channel_id
                   AND cm.user_id = :user_id          -- the security boundary
                 WHERE m.deleted_at IS NULL AND s.state = :state
                 ORDER BY s.created_at DESC
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "state": state, "limit": limit},
        )
    ).fetchall()
    return [
        {
            "message": to_message(row),
            "state": row.later_state,
            "remindAt": require_iso(row.remind_at) if row.remind_at else None,
            "remindedAt": require_iso(row.reminded_at) if row.reminded_at else None,
            "note": row.note,
        }
        for row in rows
    ]


async def list_saved(session: AsyncSession, user_id: str, limit: int = 100) -> list[Message]:
    """Somebody's saved messages, newest save first.

    The join against `channel_members` is the security boundary and is exactly the one
    `search` uses, for the same reason and with the same consequence: leaving a channel
    takes its messages out of your list. Saving cannot be a way to keep reading a
    conversation you were removed from, and a row in this table is not permission.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT} FROM messages m
                  JOIN saved_items s
                    ON s.message_id = m.id AND s.user_id = :user_id
                  JOIN channel_members cm
                    ON cm.channel_id = m.channel_id
                   AND cm.user_id = :user_id          -- the security boundary
                 WHERE m.deleted_at IS NULL
                 ORDER BY s.created_at DESC
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        )
    ).fetchall()
    return [to_message(row) for row in rows]


async def saved_message_ids(session: AsyncSession, user_id: str, limit: int = 500) -> list[str]:
    """Just the ids, for the boot payload.

    The client needs these to label one menu item — "Save for later" against "Remove
    from later" — and putting a per-user flag on `Message` itself would mean threading a
    user id through `MESSAGE_SELECT`, which is also what every broadcast is built from
    and has no single reader. Per-user state belongs with the other per-user state.

    Deliberately not access-filtered: an id is not content, this runs on every boot, and
    the list that renders them is. A stale id costs one wrong menu label until the next
    boot, which is the correct amount of machinery for the problem.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT message_id FROM saved_items
                 WHERE user_id = :user_id
                 ORDER BY created_at DESC
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        )
    ).fetchall()
    return [str(row.message_id) for row in rows]


async def add_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str) -> bool:
    rows = (
        await session.execute(
            text(
                """
                INSERT INTO reactions (message_id, user_id, emoji)
                VALUES (:message_id, :user_id, :emoji)
                ON CONFLICT DO NOTHING RETURNING message_id
                """
            ),
            {"message_id": message_id, "user_id": user_id, "emoji": emoji},
        )
    ).fetchall()
    return len(rows) > 0


async def remove_reaction(session: AsyncSession, message_id: str, user_id: str, emoji: str) -> bool:
    rows = (
        await session.execute(
            text(
                """
                DELETE FROM reactions
                 WHERE message_id = :message_id AND user_id = :user_id AND emoji = :emoji
                RETURNING message_id
                """
            ),
            {"message_id": message_id, "user_id": user_id, "emoji": emoji},
        )
    ).fetchall()
    return len(rows) > 0


async def threads_for_user(session: AsyncSession, user_id: str, limit: int = 30) -> list[Message]:
    """Threads the user started or replied to, most recently active first."""
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {MESSAGE_SELECT} FROM messages m
                  JOIN thread_subscriptions ts
                    ON ts.thread_root_id = m.id AND ts.user_id = :user_id
                 WHERE m.deleted_at IS NULL AND ts.muted = false
                 ORDER BY m.last_reply_at DESC NULLS LAST
                 LIMIT :limit
                """
            ),
            {"user_id": user_id, "limit": limit},
        )
    ).fetchall()
    return [to_message(row) for row in rows]
