"""Message reads and writes.

The send path is the heart of the app, and the ordering in `send` is deliberate: persist
inside a transaction, then broadcast and enqueue *after* it commits. An event emitted
mid-transaction lets a client fetch a message the database hasn't committed yet.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import (
    bad_request,
    forbidden,
    mention_restricted,
    message_gone,
    posting_restricted,
    thread_gone,
)
from ..lib.ids import new_id
from ..lib.mentions import MentionResult, MentionTarget, mention_lookup_phrases, parse_mentions
from ..schemas.models import Message
from ..schemas.requests import MESSAGE_MAX_LENGTH
from . import channels as channel_service
from . import polls as poll_service
from .serialize import MESSAGE_SELECT, to_message

#: Avatars shown on a thread's summary line.
FACEPILE_LIMIT = 5


#: "Leave it alone" for optional writes, distinct from "clear it" (None).


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
    #: Whom a message Blob composes on someone's behalf mentions — exactly these, with the
    #: body not parsed for more. A task handed to an agent (`services/task_dispatch.py`)
    #: is addressed to that agent: a name in the task's own text must not notify anyone
    #: or set a second agent going, and the agent must be reached whatever its name
    #: looks like, which a parse of `@Name` cannot promise.
    mention_user_ids: Sequence[str] | None = None,
    #: The poll this message asks (ADR 0041), checked; the body is its question.
    poll: poll_service.PollDraft | None = None,
) -> SendResult:
    message_id = new_id()
    attachment_ids = attachment_ids or []
    mentions = (
        MentionResult(user_ids=list(dict.fromkeys(mention_user_ids)))
        if mention_user_ids is not None
        else parse_mentions(body, await mention_targets(session, workspace_id, body))
    )

    if thread_root_id:
        await _assert_thread_root(session, thread_root_id, channel_id)

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

    from . import activity as activity_service

    await activity_service.record_direct_mentions(
        session,
        workspace_id=workspace_id,
        channel_id=channel_id,
        message_id=message_id,
        actor_id=author_id,
        user_ids=list(mentions.user_ids),
    )

    if attachment_ids:
        await _bind_attachments(session, message_id, attachment_ids, uploader_id=author_id)
    if poll is not None:
        await poll_service.attach(
            session, message_id=message_id, workspace_id=workspace_id, draft=poll
        )

    # Only what the channel's own history will return. The pointer means "the newest
    # message in this channel", and the client compares the last row it has loaded against
    # it to decide whether a live message extends the list or belongs to some older window
    # it is looking at.
    #
    # Advancing it for a thread reply broke that comparison permanently: the pointer named
    # a message channel history never returns, so the two could never be equal again and
    # every later message in that channel was dropped from the open view until a reload.
    # It also made a reply mark the channel unread, which is the opposite of what a thread
    # is for — and is why "Mark unread" is deliberately absent from a reply's menu.
    if thread_root_id is None or also_in_channel:
        await session.execute(
            text("UPDATE channels SET last_message_id = :message_id WHERE id = :channel_id"),
            {"message_id": message_id, "channel_id": channel_id},
        )

    thread_update: ThreadUpdate | None = None
    if thread_root_id:
        thread_update = await _count_reply(
            session, thread_root_id, message_id, author_id=author_id, channel_id=channel_id
        )

    await _mark_author_read(session, author_id, channel_id, message_id)

    row = (
        await session.execute(
            text(f"SELECT {MESSAGE_SELECT} FROM messages m WHERE m.id = :id"),
            {"id": message_id},
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not store that message.")

    return SendResult(message=to_message(row), created=True, thread_update=thread_update)


async def _assert_thread_root(session: AsyncSession, root_id: str, channel_id: str) -> None:
    """A reply's root has to exist and be in the same channel."""
    root = (
        await session.execute(
            text("SELECT id, channel_id FROM messages WHERE id = :id"), {"id": root_id}
        )
    ).fetchone()
    if root is None or root.channel_id != channel_id:
        raise thread_gone()


async def _bind_attachments(
    session: AsyncSession, message_id: str, attachment_ids: list[str], *, uploader_id: str
) -> None:
    """Only the uploader's own unbound, finished uploads can be attached.

    Finished matters: `/complete` is where an upload's real size and type are checked,
    so a ticket that never went through it carries only what the browser claimed.
    """
    bound = (
        await session.execute(
            text(
                """
                UPDATE attachments SET message_id = :message_id
                 WHERE id = ANY(cast(:ids AS uuid[]))
                   AND uploader_id = :uploader_id
                   AND message_id IS NULL
                   AND uploaded_at IS NOT NULL
                RETURNING id
                """
            ),
            {"message_id": message_id, "ids": attachment_ids, "uploader_id": uploader_id},
        )
    ).fetchall()
    if len(bound) != len(attachment_ids):
        raise bad_request("One of those attachments is no longer available.")


async def _count_reply(
    session: AsyncSession, root_id: str, message_id: str, *, author_id: str, channel_id: str
) -> ThreadUpdate | None:
    """A reply lands: the root's counters move, and the author follows the thread.

    Replying subscribes you to the thread, the way every chat app behaves.
    """
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
            {"root_id": root_id, "author_id": author_id, "facepile": FACEPILE_LIMIT},
        )
    ).fetchone()
    await session.execute(
        text(
            """
            INSERT INTO thread_subscriptions (user_id, thread_root_id, last_read_reply_id)
            VALUES (:user_id, :root_id, :message_id)
            ON CONFLICT (user_id, thread_root_id)
              DO UPDATE SET last_read_reply_id = EXCLUDED.last_read_reply_id
            """
        ),
        {"user_id": author_id, "root_id": root_id, "message_id": message_id},
    )
    if root_row is None:
        return None
    from ..schemas.base import iso

    return ThreadUpdate(
        root_id=root_id,
        channel_id=channel_id,
        reply_count=root_row.reply_count,
        reply_user_ids=list(root_row.reply_user_ids or []),
        last_reply_at=iso(root_row.last_reply_at),
    )


async def _mark_author_read(
    session: AsyncSession, author_id: str, channel_id: str, message_id: str
) -> None:
    """The author has, by definition, read their own message."""
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


#: What belongs in a channel's own history.
#:
#: Thread replies are kept out of the channel, which is the whole point of a thread — but
#: not the ones whose author ticked "Also send to #channel". That tick had been stored and
#: never read: the filter said `thread_root_id IS NULL` in all three paging modes, so the
#: box promised a broadcast that reached nobody, including the person who ticked it.
IN_CHANNEL_HISTORY = "(m.thread_root_id IS NULL OR m.also_in_channel)"

#: A deleted message stays in history only while replies hang from it (ADR 0039) — the
#: tombstone Slack draws where a thread would otherwise lose its root, and nowhere else.
#: The live client already dropped a deleted message on `message.deleted`, but a reload
#: brought it back as "This message was deleted", and a year that retention swept would
#: have come back as a wall of them. The reconnect replay (`changed_since`) still sends
#: deleted rows, so a client drops what it held.
STILL_SHOWN = "(m.deleted_at IS NULL OR m.reply_count > 0)"


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
                      WHERE m.channel_id = :channel_id AND {IN_CHANNEL_HISTORY}
                        AND {STILL_SHOWN} AND m.id <= :around
                      ORDER BY m.id DESC LIMIT :half)
                    UNION ALL
                    (SELECT {MESSAGE_SELECT} FROM messages m
                      WHERE m.channel_id = :channel_id AND {IN_CHANNEL_HISTORY}
                        AND {STILL_SHOWN} AND m.id > :around
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
                   AND {IN_CHANNEL_HISTORY}
                   AND {STILL_SHOWN}
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


async def thread_tail(session: AsyncSession, root_id: str, *, limit: int) -> list[Message]:
    """A thread's root and its newest `limit` replies, oldest first.

    What an agent is shown when it is asked inside a thread. `thread()` keeps the oldest
    replies under its ceiling, which is right for reading a thread from the top and wrong
    here: past the ceiling, the newest messages — the one that asked included — were the
    ones left out, and the agent answered a conversation that ended before the question.
    The root is kept whatever its age, because it says what the thread is about.
    """
    rows = (
        await session.execute(
            text(
                f"""
                SELECT * FROM (
                    SELECT {MESSAGE_SELECT} FROM messages m
                     WHERE m.thread_root_id = :root_id AND m.deleted_at IS NULL
                     ORDER BY m.id DESC
                     LIMIT :limit
                ) newest
                UNION ALL
                SELECT {MESSAGE_SELECT} FROM messages m WHERE m.id = :root_id
                """
            ),
            {"root_id": root_id, "limit": limit},
        )
    ).fetchall()
    return sorted((to_message(row) for row in rows), key=lambda m: m.id)


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
                 WHERE m.id = :root_id
                    OR (m.thread_root_id = :root_id AND m.deleted_at IS NULL)
                 ORDER BY m.id ASC
                 LIMIT 1000
                """
            ),
            {"root_id": root_id},
        )
    ).fetchall()
    return [to_message(row) for row in rows]


async def changed_since(
    session: AsyncSession, gaps: list[tuple[str, str]], *, limit: int
) -> list[Any]:
    """Everything a reconnecting client missed, for every (channel, last-seen id) at once.

    One statement for every gap: this runs on every reconnect for every user, and a
    deploy used to fan out one query per channel per client. New ids are the cheap
    half. Edits, deletes and reactions on older rows do not change id, so they are
    replayed against the cursor message's created_at — otherwise an offline edit
    vanished on reconnect. Rows come back grouped by channel; a channel with more than
    `limit - 1` of them is one the caller should refetch rather than replay.
    """
    return list(
        (
            await session.execute(
                text(
                    f"""
                    SELECT sub.* FROM unnest(
                             cast(:channel_ids AS uuid[]), cast(:cursors AS uuid[])
                           ) AS gap(channel_id, cursor)
                      JOIN messages cursor_msg ON cursor_msg.id = gap.cursor
                      JOIN LATERAL (
                        SELECT {MESSAGE_SELECT} FROM messages m
                         WHERE m.channel_id = gap.channel_id
                           AND (
                             m.id > gap.cursor
                             OR m.edited_at > cursor_msg.created_at
                             OR m.deleted_at > cursor_msg.created_at
                             OR EXISTS (
                               SELECT 1 FROM reactions r
                                WHERE r.message_id = m.id
                                  AND r.created_at > cursor_msg.created_at
                             )
                           )
                         ORDER BY m.id ASC LIMIT :limit
                      ) sub ON true
                     ORDER BY sub.channel_id, sub.id
                    """
                ),
                {
                    "channel_ids": [c for c, _ in gaps],
                    "cursors": [c for _, c in gaps],
                    "limit": limit,
                },
            )
        ).fetchall()
    )


async def load_for(
    session: AsyncSession,
    user_id: str,
    message_id: str,
    *,
    allow_deleted: bool = False,
    require_member: bool = False,
    require_writable: bool = False,
    gone: Callable[[], Exception] = message_gone,
) -> Message:
    """The prologue every per-message route performs: fetch, refuse the missing and
    (usually) the deleted, and make the channel answer for who may act.

    One place, so "does this route check deleted_at" is a decision rather than a
    per-route accident — it was in seven slightly different places once, and which
    three of them checked was not something anybody had chosen. `allow_deleted` exists
    for deletion itself (deleting twice stays idempotent) and for thread roots, whose
    replies outlive them. `gone` is the sentence for a missing row: a thread route says
    the thread is gone, not the message.
    """
    message = await by_id(session, message_id)
    if message is None or (message.deleted_at is not None and not allow_deleted):
        raise gone()
    await channel_service.assert_channel_access(
        session,
        user_id,
        message.channel_id,
        require_member=require_member,
        require_writable=require_writable,
    )
    return message


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
        raise message_gone()
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
        raise message_gone()
    return message


async def replace_blocks(
    session: AsyncSession, message_id: str, blocks: list[dict[str, Any]] | None
) -> Message | None:
    """Swap the structured content under a message without touching its text.

    This is Blob settling its own card — a decision that has been answered, buttons that
    have expired — not the author editing, so `edited_at` is deliberately left alone: an
    "(edited)" mark would claim the bot changed its mind. None if the message is gone.
    """
    row = (
        await session.execute(
            text(
                """
                UPDATE messages SET blocks = cast(:blocks AS jsonb)
                 WHERE id = :id AND deleted_at IS NULL
                RETURNING id
                """
            ),
            {"id": message_id, "blocks": json.dumps(blocks) if blocks is not None else None},
        )
    ).fetchone()
    if row is None:
        return None
    return await by_id(session, message_id)


async def preview_picture_key(session: AsyncSession, message_id: str) -> str | None:
    """Where Blob keeps the picture of this message's link preview, if it kept one."""
    row = (
        await session.execute(
            text(
                """
                SELECT link_preview->>'imageKey' AS key FROM messages
                 WHERE id = :id AND deleted_at IS NULL
                """
            ),
            {"id": message_id},
        )
    ).fetchone()
    return row.key if row is not None else None


async def assert_may_post(
    session: AsyncSession,
    *,
    author_id: str,
    workspace_id: str,
    channel_id: str,
    body: str,
    thread_root_id: str | None,
) -> None:
    """Announcement channels and the workspace's @channel rule (M3 · B3), for a person's
    own message. Somebody who is not an admin posts in an admins-only channel only in its
    threads, and uses @channel, @here and @everyone only where the workspace allows it.
    Agents and apps are not checked here: their messages take other paths, under the
    admin who installed them."""
    from ..lib.mentions import parse_mentions
    from .workspace_settings import parse as parse_settings

    row = (
        await session.execute(
            text(
                """
                SELECT u.role, c.posting, c.name, s.settings
                  FROM users u
                  JOIN channels c ON c.id = :channel_id
                  LEFT JOIN workspace_settings s ON s.workspace_id = :workspace_id
                 WHERE u.id = :author_id
                """
            ),
            {"author_id": author_id, "channel_id": channel_id, "workspace_id": workspace_id},
        )
    ).fetchone()
    if row is None or row.role in ("admin", "owner"):
        return
    if thread_root_id is None and row.posting == "admins":
        raise posting_restricted(row.name)
    if (
        parse_mentions(body, {}).everyone
        and parse_settings(row.settings).everyone_mentions == "admins"
    ):
        raise mention_restricted()


# ─── voice messages (M3 · B2) ──────────────────────────────────────────────────


def is_voice_note(message: Message) -> bool:
    """A recording sent on its own: a voice attachment, and no words typed beside it. Its
    transcript becomes its words (migration 0038), so until then there is nothing to read."""
    return not message.body.strip() and any(a.kind == "voice" for a in message.attachments)


async def mark_transcript(session: AsyncSession, message_id: str, status: str) -> None:
    await session.execute(
        text(
            """
            UPDATE attachments SET transcript_status = :status
             WHERE message_id = :id AND kind = 'voice'
            """
        ),
        {"id": message_id, "status": status},
    )


async def voice_to_transcribe(session: AsyncSession, message_id: str) -> Any:
    """The recording a message is waiting on a transcript for, if it still is."""
    return (
        await session.execute(
            text(
                """
                SELECT a.object_key, a.filename, a.mime, a.size_bytes, m.channel_id,
                       m.author_id
                  FROM attachments a JOIN messages m ON m.id = a.message_id
                 WHERE a.message_id = :id AND a.kind = 'voice'
                   AND a.transcript_status = 'pending'
                   AND m.deleted_at IS NULL
                 ORDER BY a.id
                 LIMIT 1
                """
            ),
            {"id": message_id},
        )
    ).fetchone()


async def set_transcript(
    session: AsyncSession, message_id: str, *, transcript: str, provider: str
) -> Message | None:
    """The words a recording said become its message's words — what search indexes, what
    a notification previews, what an agent reads. Blob writing them, not the author
    editing, so `edited_at` is left alone (as `replace_blocks` leaves it). Only a body
    still empty is filled: somebody may have edited one in the meantime."""
    await session.execute(
        text(
            """
            UPDATE attachments
               SET transcript_status = 'done', transcript_provider = :provider
             WHERE message_id = :id AND kind = 'voice'
            """
        ),
        {"id": message_id, "provider": provider},
    )
    await session.execute(
        text(
            """
            UPDATE messages SET body = :body
             WHERE id = :id AND deleted_at IS NULL AND body = ''
            """
        ),
        {"id": message_id, "body": transcript[:MESSAGE_MAX_LENGTH]},
    )
    return await by_id(session, message_id)


async def remove(
    session: AsyncSession, message_id: str, user_id: str, is_admin: bool
) -> tuple[str, str | None]:
    """Soft delete.

    The row survives because thread replies reference it; the body goes now, the files
    are refused by every route from now on (`routers/files.py`), and the nightly sweep
    deletes them from storage and then their rows (`jobs/retention.purge_deleted_files`).
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
        raise message_gone()
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
    # A poll goes with its question, and who chose what with it (ADR 0041).
    await session.execute(text("DELETE FROM polls WHERE message_id = :id"), {"id": message_id})
    if existing.thread_root_id:
        await session.execute(
            text("UPDATE messages SET reply_count = GREATEST(reply_count - 1, 0) WHERE id = :id"),
            {"id": existing.thread_root_id},
        )
    # The message — or a deleted root whose last reply this was — may have been the newest
    # thing history shows, and history no longer shows it.
    await settle_last_message(
        session,
        [str(existing.channel_id)],
        [message_id, *([str(existing.thread_root_id)] if existing.thread_root_id else [])],
    )

    return existing.channel_id, existing.thread_root_id


async def settle_last_message(
    session: AsyncSession, channel_ids: list[str], hidden: list[str]
) -> dict[str, str | None]:
    """Move `channels.last_message_id` back to the newest message history still shows,
    where it named one of `hidden` — messages that may just have left history.

    The client compares the last row it loaded with this pointer to decide whether a live
    message extends the list (see `send`), so a pointer naming a row history no longer
    returns would drop every later message from the open view. Answers with the channels
    whose pointer moved, and where to.
    """
    if not channel_ids or not hidden:
        return {}
    rows = (
        await session.execute(
            text(
                f"""
                UPDATE channels c
                   SET last_message_id = (
                         SELECT m.id FROM messages m
                          WHERE m.channel_id = c.id AND {IN_CHANNEL_HISTORY}
                            AND {STILL_SHOWN}
                          ORDER BY m.id DESC
                          LIMIT 1)
                 WHERE c.id = ANY(cast(:channels AS uuid[]))
                   AND c.last_message_id = ANY(cast(:hidden AS uuid[]))
                RETURNING c.id, c.last_message_id
                """
            ),
            {"channels": channel_ids, "hidden": hidden},
        )
    ).fetchall()
    return {str(row.id): str(row.last_message_id) if row.last_message_id else None for row in rows}


#: Cheap enough to run on every send, and only decides whether to *ask* for an unfurl.
URL_RE = re.compile(r"https?://")


async def addressed_by_the_room(session: AsyncSession, *, channel_id: str) -> bool:
    """Whether a message here needs no `@name` to reach an agent.

    True for a one-to-one DM that holds an enabled agent the room may address: a resident
    one (`answers_dm_without_mention`) or somebody's own. `jobs/agui.py` has answered such
    a room without a mention since the personal agent shipped — see `personal_agent_for`,
    which is the authority on the exact rule and re-checks every condition when the job
    runs. Nothing ever *enqueued* the job, though: the send path asked for a run only when
    the message mentioned somebody, so the room was the address everywhere except where a
    person types. Typing into the agent's own DM did nothing at all, and the client's
    empty state promised the opposite.

    Deliberately looser than `personal_agent_for`, and in the safe direction. This decides
    whether to *ask*; the job decides whether to *run*, and a job that finds no agent
    returns having done nothing. A predicate too tight here loses the answer with no trace,
    which is the failure being fixed; one too loose costs a no-op job.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT 1
                  FROM channels c
                  JOIN channel_members m ON m.channel_id = c.id
                  JOIN users u ON u.id = m.user_id AND u.kind = 'bot'
                                AND u.deactivated_at IS NULL
                  JOIN plugins p ON p.id = u.bot_plugin_id
                                AND p.status = 'enabled'
                                -- Looser than the job on purpose (see above): the job
                                -- checks that the owner is the person in the room.
                                AND (p.answers_dm_without_mention
                                     OR p.owner_user_id IS NOT NULL)
                 WHERE c.id = :channel_id AND c.kind = 'dm'
                 LIMIT 1
                """
            ),
            {"channel_id": channel_id},
        )
    ).first()
    return row is not None


async def is_guest(session: AsyncSession, user_id: str | None) -> bool:
    if user_id is None:
        return False
    role = (
        await session.execute(text("SELECT role FROM users WHERE id = :id"), {"id": user_id})
    ).scalar_one_or_none()
    return role == "guest"


async def announce(
    session: AsyncSession,
    after: Any,
    result: SendResult,
    *,
    workspace_id: str,
    channel_id: str,
    start_agent_runs: bool = True,
) -> None:
    """Everything that has to happen because a message now exists.

    Both send paths call this, and that is the whole point of it existing. The live one
    in `routers/messages.py` did all of this inline; the scheduled sweep in
    `jobs/scheduled.py` did none of it, so a message sent by a schedule was stored and
    then silently went nowhere — no socket frame, so nobody with the channel open saw it
    until they reloaded; no `notify`, so no badge and no push; no `unfurl`, so a link in
    it never got a preview; no `agui_run`, so mentioning an agent in a scheduled message
    did nothing at all; and no outbox row, so no app ever heard about it.

    The comment in the sweep even claimed `after` was "what makes the socket see a
    message that is actually stored" — while binding it as `_after` and dropping it. Two
    copies of a fan-out is how that happens, so now there is one.

    The plugin outbox row is written *inside* the transaction on purpose: it and the
    message commit together or not at all, so an app is never told about a message that
    was rolled back and never misses one because the process died after COMMIT. The rest
    goes through `after`, which drains past COMMIT — a client must never be told about a
    row that has not committed.
    """
    if not result.created:
        # A repeated client_msg_id returned the stored row. It was announced the first
        # time; announcing it again would double every notification.
        return

    # Imported here rather than at module scope: `realtime` and `plugins` both reach back
    # into services, and this module is imported by nearly all of them.
    from ..lib.queue import enqueue, fire_and_forget
    from ..plugins import events as plugin_events
    from ..realtime import hub
    from .serialize import message_event

    await plugin_events.emit(
        session,
        workspace_id=workspace_id,
        event="message.created",
        channel_id=channel_id,
        payload=result.message.model_dump(by_alias=True),
    )

    # Asked before COMMIT, because `broadcast` runs past it and the session is gone by
    # then. Only for a person's own message: an agent's reply in a two-member room is
    # itself "a message in the agent's DM", so rooting a chain from it is how a DM
    # holding two agents talks to itself for ever. ADR 0013 puts a person at the root of
    # every chain, and this is that rule at the one place a new trigger could appear.
    by_the_room = result.message.kind == "user" and await addressed_by_the_room(
        session, channel_id=channel_id
    )
    # An agent following this channel hears a person's message that mentions nobody
    # (ADR 0026), so that message goes to the run job too; who may hear it is decided there.
    from .agent_follows import is_followed

    followed = result.message.kind == "user" and await is_followed(session, channel_id=channel_id)
    # A guest's message starts no agent run (ADR 0034). A run acts with its asker's reach
    # through tools written for members — the directory, every public channel — and a
    # guest's reach is a handful of rooms.
    from_a_guest = result.message.kind == "user" and await is_guest(
        session, result.message.author_id
    )
    # A voice message's words arrive later, from the speech service (M3 · B2): until then
    # it has none for an agent to read, so any run it would start waits for them — the
    # transcribe job starts it once the words are written. With no speech service there
    # will be no words. The agent whose DM it is still hears that a recording came — its
    # input names it — so it can say it cannot listen rather than say nothing; a follower,
    # which nobody addressed, is not woken for words that are not there.
    from ..lib import stt

    voice = is_voice_note(result.message)
    transcribing = voice and stt.configured()
    if transcribing:
        await mark_transcript(session, result.message.id, "pending")
    if voice:
        heard = by_the_room and not transcribing
    else:
        heard = bool(result.message.mention_user_ids) or by_the_room or followed

    def broadcast() -> None:
        hub.to_channel(channel_id, message_event("message.new", result.message))
        if result.thread_update:
            hub.to_channel(channel_id, result.thread_update.as_event())
        fire_and_forget(enqueue("notify", result.message.id))
        if URL_RE.search(result.message.body):
            fire_and_forget(enqueue("unfurl", result.message.id))
        if transcribing:
            fire_and_forget(enqueue("transcribe", result.message.id))
        # A mention might be of an app that answers over AG-UI. Which one is the job's
        # problem, not this one's. A person's message roots a chain; an agent's reply
        # extends one only through `jobs/agui.py`, which is why bot posts through the
        # bot API never reach here with a parent — see ADR 0013. `start_agent_runs` is
        # False for exactly one caller: the message that answers a decision an agent
        # was waiting on. That message *resumes* the run that asked, and rooting a
        # second chain from it would race the resume for the same agent.
        if start_agent_runs and not from_a_guest and heard:
            fire_and_forget(enqueue("agui_run", result.message.id))
        # The outbox drains on a timer too, so this is latency rather than delivery.
        fire_and_forget(enqueue("deliver_plugin_events"))

    after.add(broadcast)
