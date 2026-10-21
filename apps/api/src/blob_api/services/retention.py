"""Retention and legal hold (ADR 0039).

An admin chooses how long messages, and separately files, are kept. Each night, an hour
after the backup, `jobs/retention.sweep_history` removes what has crossed the line with
the statements here. A conversation on legal hold, every conversation somebody on hold is
in, and everything they wrote are skipped.

Past the message line a message becomes the tombstone a delete leaves, and also loses what
a delete still leaves behind — its files, its preview's picture, its translations, its
thread's summary, its pin, its place in Later. Past the file line it keeps its words and
loses its files, with `files_removed` saying how many. Tasks, decisions and work artifacts
are never touched: retention removes the talk, not the work.

Ids are UUIDv7, so "past the line" is `id < line_id(cutoff)`: a walk of the primary key,
not of an index on `created_at` the table does not have.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import channel_gone, no_such_person
from . import audit as audit_service
from . import messages as message_service
from . import workspace_settings as settings_service
from .audit import Actor

#: A changed window waits this long before the sweep acts on it, so a wrong choice can be
#: put back before anything is removed.
GRACE = timedelta(hours=24)
#: The preview counts this far and then says "more than".
PREVIEW_CAP = 100_000


@dataclass(frozen=True, slots=True)
class Policy:
    message_days: int | None = None
    file_days: int | None = None
    changed_at: datetime | None = None

    @property
    def enabled(self) -> bool:
        return self.message_days is not None or self.file_days is not None

    @property
    def file_window(self) -> int | None:
        """Days a file is kept: its own window, or its message's when that is shorter — a
        file never outlives the message it is on."""
        windows = [days for days in (self.file_days, self.message_days) if days is not None]
        return min(windows) if windows else None

    def takes_effect_at(self, now: datetime) -> datetime | None:
        """When the last change starts to count, while it is still waiting; else None."""
        if self.changed_at is None or now >= self.changed_at + GRACE:
            return None
        return self.changed_at + GRACE

    def in_force(self, now: datetime) -> bool:
        return self.takes_effect_at(now) is None


@dataclass(frozen=True, slots=True)
class Held:
    """What the sweep must not touch: held conversations (and those a held person is in),
    and held people, whose words are kept wherever they are."""

    channels: list[str]
    people: list[str]


@dataclass(frozen=True, slots=True)
class Preview:
    messages: int
    files: int
    capped: bool


@dataclass(frozen=True, slots=True)
class Swept:
    """What `tombstone` changed: the rows, and each conversation whose newest message went
    — its pointer now names the newest one history still shows, or nothing."""

    rows: list[Any]
    last_message: dict[str, str | None]


def from_settings(typed: settings_service.TypedSettings) -> Policy:
    return Policy(
        message_days=typed.message_retention_days,
        file_days=typed.file_retention_days,
        changed_at=typed.retention_changed_at,
    )


async def policy(session: AsyncSession, workspace_id: str) -> Policy:
    return from_settings(await settings_service.load_in(session, workspace_id))


def line_id(cutoff: datetime) -> str:
    """The smallest UUIDv7 an instant can mint. Everything made at or after `cutoff` has an
    id at least this; everything made before has a smaller one."""
    hexed = f"{int(cutoff.timestamp() * 1000):012x}"
    return f"{hexed[:8]}-{hexed[8:]}-7000-8000-000000000000"


def _window(days: int | None) -> str:
    if days is None:
        return "forever"
    return "1 day" if days == 1 else f"{days} days"


async def set_policy(
    session: AsyncSession, actor: Actor, *, message_days: int | None, file_days: int | None
) -> Policy:
    """Save both windows. An unchanged pair changes nothing, so it does not start the day's
    wait again."""
    before = await policy(session, actor.workspace_id)
    if (before.message_days, before.file_days) == (message_days, file_days):
        return before
    now = datetime.now(UTC)
    await session.execute(
        text(
            """
            INSERT INTO workspace_settings (workspace_id, settings, updated_by)
            VALUES (:ws, cast(:settings AS jsonb), :actor)
            ON CONFLICT (workspace_id) DO UPDATE
              SET settings = workspace_settings.settings || EXCLUDED.settings,
                  updated_at = now(),
                  updated_by = EXCLUDED.updated_by
            """
        ),
        {
            "ws": actor.workspace_id,
            "settings": json.dumps(
                {
                    "messageRetentionDays": message_days,
                    "fileRetentionDays": file_days,
                    "retentionChangedAt": now.isoformat(),
                }
            ),
            "actor": actor.id,
        },
    )
    await audit_service.record(
        session,
        actor,
        "retention.updated",
        target_type="workspace",
        target_id=actor.workspace_id,
        metadata={
            "messages": f"{_window(before.message_days)} → {_window(message_days)}",
            "files": f"{_window(before.file_days)} → {_window(file_days)}",
        },
    )
    return Policy(message_days=message_days, file_days=file_days, changed_at=now)


# ─── legal hold ───────────────────────────────────────────────────────────────


async def hold_conversation(
    session: AsyncSession, actor: Actor, channel_id: str, *, held: bool
) -> bool:
    """Place or release a conversation's hold. True when it changed; placing a hold that is
    already there, or releasing one that is not, changes nothing and records nothing."""
    exists = (
        await session.execute(
            text("SELECT 1 FROM channels WHERE id = :id AND workspace_id = :ws"),
            {"id": channel_id, "ws": actor.workspace_id},
        )
    ).fetchone()
    if exists is None:
        raise channel_gone()
    changed = (
        await session.execute(
            text(
                """
                UPDATE channels SET legal_hold_at = now(), legal_hold_by = :actor
                 WHERE id = :id AND legal_hold_at IS NULL
                RETURNING id
                """
                if held
                else """
                UPDATE channels SET legal_hold_at = NULL, legal_hold_by = NULL
                 WHERE id = :id AND legal_hold_at IS NOT NULL
                RETURNING id
                """
            ),
            {"id": channel_id, "actor": actor.id} if held else {"id": channel_id},
        )
    ).fetchone()
    if changed is None:
        return False
    await audit_service.record(
        session,
        actor,
        "legal_hold.placed" if held else "legal_hold.released",
        target_type="channel",
        target_id=channel_id,
    )
    return True


async def hold_person(session: AsyncSession, actor: Actor, user_id: str, *, held: bool) -> bool:
    """Place or release a person's hold: what they wrote, and every conversation they are
    in, is kept past the windows."""
    exists = (
        await session.execute(
            text("SELECT 1 FROM users WHERE id = :id AND workspace_id = :ws"),
            {"id": user_id, "ws": actor.workspace_id},
        )
    ).fetchone()
    if exists is None:
        raise no_such_person()
    changed = (
        await session.execute(
            text(
                """
                UPDATE users SET legal_hold_at = now(), legal_hold_by = :actor
                 WHERE id = :id AND legal_hold_at IS NULL
                RETURNING id
                """
                if held
                else """
                UPDATE users SET legal_hold_at = NULL, legal_hold_by = NULL
                 WHERE id = :id AND legal_hold_at IS NOT NULL
                RETURNING id
                """
            ),
            {"id": user_id, "actor": actor.id} if held else {"id": user_id},
        )
    ).fetchone()
    if changed is None:
        return False
    await audit_service.record(
        session,
        actor,
        "legal_hold.placed" if held else "legal_hold.released",
        target_type="user",
        target_id=user_id,
    )
    return True


async def held_conversations(session: AsyncSession, workspace_id: str) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT c.id, c.kind, c.name, c.legal_hold_at, b.display_name AS held_by
                      FROM channels c
                      LEFT JOIN users b ON b.id = c.legal_hold_by
                     WHERE c.workspace_id = :ws AND c.legal_hold_at IS NOT NULL
                     ORDER BY c.legal_hold_at
                    """
                ),
                {"ws": workspace_id},
            )
        ).fetchall()
    )


async def held_people(session: AsyncSession, workspace_id: str) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT u.id, u.display_name, u.legal_hold_at, b.display_name AS held_by
                      FROM users u
                      LEFT JOIN users b ON b.id = u.legal_hold_by
                     WHERE u.workspace_id = :ws AND u.legal_hold_at IS NOT NULL
                     ORDER BY u.legal_hold_at
                    """
                ),
                {"ws": workspace_id},
            )
        ).fetchall()
    )


async def is_held(session: AsyncSession, user_id: str) -> bool:
    """Whether this person is on hold — theirs to know (ADR 0039)."""
    row = (
        await session.execute(
            text("SELECT legal_hold_at IS NOT NULL AS held FROM users WHERE id = :id"),
            {"id": user_id},
        )
    ).fetchone()
    return bool(row and row.held)


async def held_scope(session: AsyncSession, workspace_id: str) -> Held:
    """Read per batch, so a hold placed while a sweep is running applies from its next
    batch. Two small reads: the held people, then the held conversations and every one a
    held person is in — from their memberships, not by asking each conversation."""
    people = [
        str(row.id)
        for row in (
            await session.execute(
                text("SELECT id FROM users WHERE workspace_id = :ws AND legal_hold_at IS NOT NULL"),
                {"ws": workspace_id},
            )
        ).fetchall()
    ]
    channels = (
        await session.execute(
            text(
                """
                SELECT id FROM channels
                 WHERE workspace_id = :ws AND legal_hold_at IS NOT NULL
                UNION
                SELECT channel_id FROM channel_members
                 WHERE user_id = ANY(cast(:people AS uuid[]))
                """
            ),
            {"ws": workspace_id, "people": people},
        )
    ).fetchall()
    return Held(channels=[str(row.id) for row in channels], people=people)


# ─── what a window would take ─────────────────────────────────────────────────


async def preview(
    session: AsyncSession,
    workspace_id: str,
    *,
    message_days: int | None,
    file_days: int | None,
    now: datetime,
) -> Preview:
    """About what the first sweep under these windows would remove — counted now, so a day
    early, and up to `PREVIEW_CAP` of each."""
    shape = Policy(message_days=message_days, file_days=file_days)
    held = await held_scope(session, workspace_id)
    messages = files = 0
    if shape.message_days is not None:
        messages = (
            await session.execute(
                text(
                    """
                    SELECT count(*) AS n FROM (
                      SELECT 1 FROM messages m
                       WHERE m.workspace_id = :ws
                         AND m.id < cast(:line AS uuid)
                         AND m.deleted_at IS NULL
                         AND m.channel_id <> ALL(cast(:held_channels AS uuid[]))
                         AND (m.author_id IS NULL
                              OR m.author_id <> ALL(cast(:held_people AS uuid[])))
                       LIMIT :cap
                    ) past
                    """
                ),
                {
                    "ws": workspace_id,
                    "line": line_id(now - timedelta(days=shape.message_days)),
                    "held_channels": held.channels,
                    "held_people": held.people,
                    "cap": PREVIEW_CAP,
                },
            )
        ).scalar_one()
    if shape.file_window is not None:
        files = (
            await session.execute(
                text(
                    """
                    SELECT count(*) AS n FROM (
                      SELECT 1 FROM attachments a
                        JOIN messages m ON m.id = a.message_id
                       WHERE a.workspace_id = :ws
                         AND a.message_id < cast(:line AS uuid)
                         AND m.channel_id <> ALL(cast(:held_channels AS uuid[]))
                         AND (m.author_id IS NULL
                              OR m.author_id <> ALL(cast(:held_people AS uuid[])))
                       LIMIT :cap
                    ) past
                    """
                ),
                {
                    "ws": workspace_id,
                    "line": line_id(now - timedelta(days=shape.file_window)),
                    "held_channels": held.channels,
                    "held_people": held.people,
                    "cap": PREVIEW_CAP,
                },
            )
        ).scalar_one()
    return Preview(
        messages=int(messages),
        files=int(files),
        capped=messages >= PREVIEW_CAP or files >= PREVIEW_CAP,
    )


# ─── the sweep's statements ───────────────────────────────────────────────────


async def messages_past(
    session: AsyncSession,
    workspace_id: str,
    *,
    line: str,
    after: str | None,
    held: Held,
    limit: int,
) -> list[Any]:
    """The next live messages past the line, oldest first, with every object they hold:
    each file and its thumbnail, and the preview's picture."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT m.id, m.channel_id, m.thread_root_id,
                           m.link_preview ->> 'imageKey' AS picture_key,
                           (SELECT count(*) FROM attachments a
                             WHERE a.message_id = m.id)::int AS file_count,
                           COALESCE((
                             SELECT array_agg(k) FROM attachments a
                              CROSS JOIN LATERAL unnest(ARRAY[a.object_key, a.thumb_key]) AS k
                              WHERE a.message_id = m.id AND k IS NOT NULL
                           ), '{}') AS object_keys
                      FROM messages m
                     WHERE m.workspace_id = :ws
                       AND m.id < cast(:line AS uuid)
                       AND (cast(:after AS uuid) IS NULL OR m.id > cast(:after AS uuid))
                       AND m.deleted_at IS NULL
                       AND m.channel_id <> ALL(cast(:held_channels AS uuid[]))
                       AND (m.author_id IS NULL
                            OR m.author_id <> ALL(cast(:held_people AS uuid[])))
                     ORDER BY m.id
                     LIMIT :limit
                    """
                ),
                {
                    "ws": workspace_id,
                    "line": line,
                    "after": after,
                    "held_channels": held.channels,
                    "held_people": held.people,
                    "limit": limit,
                },
            )
        ).fetchall()
    )


async def tombstone(session: AsyncSession, message_ids: list[str]) -> Swept:
    """Make these messages the tombstone a delete leaves, and take what a delete leaves
    behind with them. Their objects must already be gone from storage. Answers with the
    rows it changed — one deleted meanwhile is not changed twice."""
    gone = (
        await session.execute(
            text(
                """
                UPDATE messages
                   SET deleted_at = now(), body = '', blocks = NULL, link_preview = NULL,
                       mention_user_ids = '{}', mention_group_ids = '{}',
                       mentions_everyone = false, pinned_at = NULL, pinned_by = NULL
                 WHERE id = ANY(cast(:ids AS uuid[])) AND deleted_at IS NULL
                RETURNING id, channel_id, thread_root_id
                """
            ),
            {"ids": message_ids},
        )
    ).fetchall()
    ids = [str(row.id) for row in gone]
    if not ids:
        return Swept(rows=[], last_message={})
    for statement in (
        "DELETE FROM reactions WHERE message_id = ANY(cast(:ids AS uuid[]))",
        "DELETE FROM attachments WHERE message_id = ANY(cast(:ids AS uuid[]))",
        "DELETE FROM message_translations WHERE message_id = ANY(cast(:ids AS uuid[]))",
        "DELETE FROM thread_summaries WHERE thread_root_id = ANY(cast(:ids AS uuid[]))",
        "DELETE FROM saved_items WHERE message_id = ANY(cast(:ids AS uuid[]))",
        "DELETE FROM activity_events WHERE message_id = ANY(cast(:ids AS uuid[]))",
    ):
        await session.execute(text(statement), {"ids": ids})
    # A reply that goes takes its count off its thread, as a delete does — so a root whose
    # replies have all gone stops drawing "2 replies" on its tombstone.
    replies: dict[str, int] = {}
    for row in gone:
        if row.thread_root_id is not None:
            root = str(row.thread_root_id)
            replies[root] = replies.get(root, 0) + 1
    if replies:
        await session.execute(
            text(
                """
                UPDATE messages r SET reply_count = GREATEST(r.reply_count - d.n, 0)
                  FROM unnest(cast(:roots AS uuid[]), cast(:counts AS int[])) AS d(root, n)
                 WHERE r.id = d.root
                """
            ),
            {"roots": list(replies), "counts": list(replies.values())},
        )
    moved = await message_service.settle_last_message(
        session, sorted({str(row.channel_id) for row in gone}), [*ids, *replies]
    )
    return Swept(rows=list(gone), last_message=moved)


async def files_past(
    session: AsyncSession,
    workspace_id: str,
    *,
    line: str,
    after: str | None,
    held: Held,
    limit: int,
) -> list[Any]:
    """Messages past the file line that still have files, oldest first, with each file's
    objects. A deleted message's files are here too: a delete left them behind."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT a.message_id, m.channel_id, m.deleted_at IS NOT NULL AS deleted,
                           array_agg(a.id) AS attachment_ids,
                           array_agg(a.object_key)
                             || array_remove(array_agg(a.thumb_key), NULL) AS object_keys
                      FROM attachments a
                      JOIN messages m ON m.id = a.message_id
                     WHERE a.workspace_id = :ws
                       AND a.message_id < cast(:line AS uuid)
                       AND (cast(:after AS uuid) IS NULL
                            OR a.message_id > cast(:after AS uuid))
                       AND m.channel_id <> ALL(cast(:held_channels AS uuid[]))
                       AND (m.author_id IS NULL
                            OR m.author_id <> ALL(cast(:held_people AS uuid[])))
                     GROUP BY a.message_id, m.channel_id, m.deleted_at
                     ORDER BY a.message_id
                     LIMIT :limit
                    """
                ),
                {
                    "ws": workspace_id,
                    "line": line,
                    "after": after,
                    "held_channels": held.channels,
                    "held_people": held.people,
                    "limit": limit,
                },
            )
        ).fetchall()
    )


async def deleted_files(session: AsyncSession, *, after: str | None, limit: int) -> list[Any]:
    """Files still kept for messages somebody deleted — every workspace's, oldest first. A
    delete promised they were gone and the routes already refuse them; this is where
    storage catches up. A hold does not keep them (ADR 0039: a hold keeps nothing people
    delete themselves)."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT a.message_id, m.channel_id, true AS deleted,
                           array_agg(a.id) AS attachment_ids,
                           array_agg(a.object_key)
                             || array_remove(array_agg(a.thumb_key), NULL) AS object_keys
                      FROM attachments a
                      JOIN messages m ON m.id = a.message_id
                     WHERE m.deleted_at IS NOT NULL
                       AND (cast(:after AS uuid) IS NULL
                            OR a.message_id > cast(:after AS uuid))
                     GROUP BY a.message_id, m.channel_id
                     ORDER BY a.message_id
                     LIMIT :limit
                    """
                ),
                {"after": after, "limit": limit},
            )
        ).fetchall()
    )


async def drop_files(session: AsyncSession, rows: list[Any]) -> None:
    """Forget files whose objects are gone, and count them on a message that keeps its
    words."""
    await session.execute(
        text("DELETE FROM attachments WHERE id = ANY(cast(:ids AS uuid[]))"),
        {"ids": [str(a) for row in rows for a in row.attachment_ids]},
    )
    live = [row for row in rows if not row.deleted]
    if live:
        await session.execute(
            text(
                """
                UPDATE messages m SET files_removed = m.files_removed + d.n
                  FROM unnest(cast(:ids AS uuid[]), cast(:counts AS int[])) AS d(id, n)
                 WHERE m.id = d.id
                """
            ),
            {
                "ids": [str(row.message_id) for row in live],
                "counts": [len(row.attachment_ids) for row in live],
            },
        )


async def pictures_past(
    session: AsyncSession,
    workspace_id: str,
    *,
    line: str,
    after: str | None,
    held: Held,
    limit: int,
) -> list[Any]:
    """Messages past the file line whose link preview still has Blob's copy of a picture —
    a deleted message's too, which kept its preview in the row."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT m.id, m.channel_id, m.deleted_at IS NOT NULL AS deleted,
                           m.link_preview ->> 'imageKey' AS picture_key
                      FROM messages m
                     WHERE m.workspace_id = :ws
                       AND m.id < cast(:line AS uuid)
                       AND (cast(:after AS uuid) IS NULL OR m.id > cast(:after AS uuid))
                       AND m.link_preview ->> 'imageKey' IS NOT NULL
                       AND m.channel_id <> ALL(cast(:held_channels AS uuid[]))
                       AND (m.author_id IS NULL
                            OR m.author_id <> ALL(cast(:held_people AS uuid[])))
                     ORDER BY m.id
                     LIMIT :limit
                    """
                ),
                {
                    "ws": workspace_id,
                    "line": line,
                    "after": after,
                    "held_channels": held.channels,
                    "held_people": held.people,
                    "limit": limit,
                },
            )
        ).fetchall()
    )


async def drop_pictures(session: AsyncSession, message_ids: list[str]) -> None:
    """A live message keeps its preview's words; a deleted one loses the preview whole."""
    await session.execute(
        text(
            """
            UPDATE messages
               SET link_preview = CASE WHEN deleted_at IS NULL
                                       THEN link_preview - 'imageKey' - 'imageUrl'
                                  END
             WHERE id = ANY(cast(:ids AS uuid[]))
            """
        ),
        {"ids": message_ids},
    )


async def forget_agent_records(
    session: AsyncSession, workspace_id: str, *, cutoff: datetime, held: Held
) -> tuple[int, int]:
    """What agents kept about talk past the line: runs started before it — their cards,
    approvals and trails — and memory and notes of a conversation untouched since. A run
    still going, or stopped to ask somebody, is left to finish."""
    runs = (
        await session.execute(
            text(
                """
                DELETE FROM agent_runs
                 WHERE workspace_id = :ws
                   AND started_at < :cutoff
                   AND status NOT IN ('running', 'waiting', 'interrupted')
                   AND channel_id <> ALL(cast(:held_channels AS uuid[]))
                RETURNING id
                """
            ),
            {"ws": workspace_id, "cutoff": cutoff, "held_channels": held.channels},
        )
    ).fetchall()
    memory = 0
    for statement in (
        """
        DELETE FROM agent_state
         WHERE workspace_id = :ws
           AND updated_at < :cutoff
           AND channel_id <> ALL(cast(:held_channels AS uuid[]))
           AND (person_id IS NULL OR person_id <> ALL(cast(:held_people AS uuid[])))
        RETURNING id
        """,
        """
        DELETE FROM agent_notes
         WHERE workspace_id = :ws
           AND updated_at < :cutoff
           AND channel_id <> ALL(cast(:held_channels AS uuid[]))
           AND (person_id IS NULL OR person_id <> ALL(cast(:held_people AS uuid[])))
        RETURNING id
        """,
    ):
        memory += len(
            (
                await session.execute(
                    text(statement),
                    {
                        "ws": workspace_id,
                        "cutoff": cutoff,
                        "held_channels": held.channels,
                        "held_people": held.people,
                    },
                )
            ).fetchall()
        )
    return len(runs), memory


__all__ = [
    "GRACE",
    "PREVIEW_CAP",
    "Held",
    "Policy",
    "Preview",
    "Swept",
    "deleted_files",
    "drop_files",
    "drop_pictures",
    "files_past",
    "forget_agent_records",
    "from_settings",
    "held_conversations",
    "held_people",
    "held_scope",
    "hold_conversation",
    "hold_person",
    "is_held",
    "line_id",
    "messages_past",
    "pictures_past",
    "policy",
    "preview",
    "set_policy",
    "tombstone",
]
