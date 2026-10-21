"""Exports (M3 · B4): taking your data with you.

Two shapes, and the line between them is the privacy rule the rest of Blob keeps. A
**workspace** export, an admin's, is its *public* conversations — every public channel,
archived ones too — with the people in the workspace, as Slack's standard export is: a
private channel's existence is private (it answers 404 to outsiders), and a DM is two
people's, so neither leaves through an admin. A **personal** export is everything one
person is in — their channels public and private, their DMs and group DMs — for that
person alone, with nobody else's email address.

The format (`blob-export/1`) is a zip of JSON lines, one object per line, so `jq` reads it
and a script can stream it: `export.json` says what it is, `users.jsonl` and
`channels.jsonl` the people and conversations, `messages/<channel id>.jsonl` each
conversation oldest first with its reactions and files, and `files.jsonl` the files —
their names, types and sizes, not their bytes, which stay in the bucket. A row in
`exports` is the request and, once built, where the zip is; both go after a week.
"""

from __future__ import annotations

import json
import zipfile
from collections.abc import AsyncIterator, Iterable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id
from ..schemas.base import iso

FORMAT = "blob-export/1"
#: How long a built export is kept for downloading.
KEEP = timedelta(days=7)
#: Messages read per round trip, by keyset, so a channel of any size streams.
PAGE = 1000

README = """\
This is a Blob export ({format}): {scope_words}.

Every .jsonl file holds one JSON object per line.

  export.json            what this is: the workspace, the scope, when, the schema
  users.jsonl            the people{emails}
  channels.jsonl         the conversations
  messages/<id>.jsonl    one conversation, oldest first, with reactions and files
  files.jsonl            the files: names, types and sizes — not their bytes

Read it with jq, for example:

  jq -r '.body' messages/*.jsonl
"""


# ─── the request ─────────────────────────────────────────────────────────────────────


async def request(
    session: AsyncSession, *, workspace_id: str, requested_by: str, scope: str
) -> str:
    export_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO exports (id, workspace_id, requested_by, scope)
            VALUES (:id, :ws, :by, :scope)
            """
        ),
        {"id": export_id, "ws": workspace_id, "by": requested_by, "scope": scope},
    )
    return export_id


async def in_progress(session: AsyncSession, requested_by: str) -> bool:
    row = (
        await session.execute(
            text(
                """
                SELECT 1 FROM exports
                 WHERE requested_by = :by AND status IN ('pending', 'running')
                 LIMIT 1
                """
            ),
            {"by": requested_by},
        )
    ).fetchone()
    return row is not None


async def listing(
    session: AsyncSession, *, workspace_id: str, requested_by: str | None, scope: str
) -> list[Any]:
    """Exports of one scope, newest first: a person's own, or the workspace's for its
    admins."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT e.id, e.scope, e.status, e.bytes, e.error, e.created_at,
                           e.finished_at, u.display_name AS requested_by_name
                      FROM exports e JOIN users u ON u.id = e.requested_by
                     WHERE e.workspace_id = :ws AND e.scope = :scope
                       AND (cast(:by AS uuid) IS NULL OR e.requested_by = cast(:by AS uuid))
                     ORDER BY e.created_at DESC
                     LIMIT 20
                    """
                ),
                {"ws": workspace_id, "scope": scope, "by": requested_by},
            )
        ).fetchall()
    )


async def get(session: AsyncSession, export_id: str) -> Any:
    return (
        await session.execute(
            text(
                """
                SELECT id, workspace_id, requested_by, scope, status, object_key, bytes,
                       created_at
                  FROM exports WHERE id = :id
                """
            ),
            {"id": export_id},
        )
    ).fetchone()


async def start(session: AsyncSession, export_id: str) -> None:
    await session.execute(
        text("UPDATE exports SET status = 'running' WHERE id = :id"), {"id": export_id}
    )


async def finish(session: AsyncSession, export_id: str, *, object_key: str, size: int) -> None:
    await session.execute(
        text(
            """
            UPDATE exports SET status = 'done', object_key = :key, bytes = :size,
                               finished_at = now()
             WHERE id = :id
            """
        ),
        {"id": export_id, "key": object_key, "size": size},
    )


async def fail(session: AsyncSession, export_id: str, *, error: str) -> None:
    await session.execute(
        text(
            """
            UPDATE exports SET status = 'failed', error = :error, finished_at = now()
             WHERE id = :id
            """
        ),
        {"id": export_id, "error": error[:500] or "failed"},
    )


async def expired(session: AsyncSession, now: datetime) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT id, object_key FROM exports
                     WHERE created_at < cast(:cutoff AS timestamptz)
                    """
                ),
                {"cutoff": now - KEEP},
            )
        ).fetchall()
    )


async def forget(session: AsyncSession, export_id: str) -> None:
    await session.execute(text("DELETE FROM exports WHERE id = :id"), {"id": export_id})


# ─── what goes in ────────────────────────────────────────────────────────────────────


async def conversations(
    session: AsyncSession, *, workspace_id: str, scope: str, person_id: str
) -> list[Any]:
    """The conversations an export holds: every public channel, or everything one person
    is in."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT c.id, c.kind, c.name, c.topic, c.description, c.created_at,
                           c.archived_at,
                           (SELECT array_agg(m.user_id ORDER BY m.user_id)
                              FROM channel_members m WHERE m.channel_id = c.id) AS member_ids
                      FROM channels c
                     WHERE c.workspace_id = :ws
                       AND CASE :scope
                             WHEN 'workspace' THEN c.kind = 'public'
                             ELSE EXISTS (SELECT 1 FROM channel_members m
                                           WHERE m.channel_id = c.id AND m.user_id = :person)
                           END
                     ORDER BY c.created_at
                    """
                ),
                {"ws": workspace_id, "scope": scope, "person": person_id},
            )
        ).fetchall()
    )


async def people(
    session: AsyncSession,
    *,
    workspace_id: str,
    scope: str,
    person_id: str,
    member_ids: Iterable[str],
) -> list[dict[str, Any]]:
    """The workspace's people for its admins, with addresses; for a person, the people in
    their conversations, and nobody's address but their own."""
    rows = (
        await session.execute(
            text(
                """
                SELECT id, email, display_name, full_name, title, timezone, role,
                       deactivated_at, bot_plugin_id
                  FROM users
                 WHERE workspace_id = :ws
                   AND (:all OR id = ANY(cast(:ids AS uuid[])))
                 ORDER BY created_at
                """
            ),
            {"ws": workspace_id, "all": scope == "workspace", "ids": list(set(member_ids))},
        )
    ).fetchall()
    out = []
    for row in rows:
        entry: dict[str, Any] = {
            "id": str(row.id),
            "kind": "bot" if row.bot_plugin_id else "human",
            "display_name": row.display_name,
            "full_name": row.full_name,
            "title": row.title,
            "timezone": row.timezone,
            "role": row.role,
            "deactivated": row.deactivated_at is not None,
        }
        if not row.bot_plugin_id and (scope == "workspace" or str(row.id) == person_id):
            entry["email"] = row.email
        out.append(entry)
    return out


async def messages_of(session: AsyncSession, channel_id: str) -> AsyncIterator[dict[str, Any]]:
    """One conversation, oldest first, a page at a time; deleted messages are left out."""
    after = None
    while True:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT m.id, m.author_id, m.kind, m.body, m.created_at, m.edited_at,
                           m.thread_root_id, m.also_in_channel, m.pinned_at,
                           coalesce((SELECT json_agg(json_build_object(
                                       'emoji', r.emoji, 'user_id', r.user_id))
                                       FROM reactions r WHERE r.message_id = m.id), '[]')
                             AS reactions,
                           coalesce((SELECT json_agg(json_build_object(
                                       'id', a.id, 'filename', a.filename, 'mime', a.mime,
                                       'size_bytes', a.size_bytes, 'kind', a.kind)
                                       ORDER BY a.id)
                                       FROM attachments a WHERE a.message_id = m.id), '[]')
                             AS attachments
                      FROM messages m
                     WHERE m.channel_id = :channel AND m.deleted_at IS NULL
                       AND (cast(:after AS uuid) IS NULL OR m.id > cast(:after AS uuid))
                     ORDER BY m.id
                     LIMIT :page
                    """
                ),
                {"channel": channel_id, "after": after, "page": PAGE},
            )
        ).fetchall()
        if not rows:
            return
        for row in rows:
            by_emoji: dict[str, list[str]] = {}
            for reaction in row.reactions or []:
                by_emoji.setdefault(reaction["emoji"], []).append(str(reaction["user_id"]))
            yield {
                "id": str(row.id),
                "author_id": str(row.author_id) if row.author_id else None,
                "kind": row.kind,
                "body": row.body,
                "created_at": iso(row.created_at),
                "edited_at": iso(row.edited_at),
                "thread_root_id": str(row.thread_root_id) if row.thread_root_id else None,
                "also_in_channel": row.also_in_channel,
                "pinned_at": iso(row.pinned_at),
                "reactions": [{"emoji": emoji, "user_ids": ids} for emoji, ids in by_emoji.items()],
                "files": list(row.attachments or []),
            }
        after = str(rows[-1].id)


def write_jsonl(path: Path, items: Iterable[dict[str, Any]]) -> None:
    with path.open("a", encoding="utf-8") as out:
        for item in items:
            out.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")


def zip_directory(source: Path, target: Path) -> int:
    """Every file under `source` into one zip. Blocking: run in a thread."""
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(source).as_posix())
    return target.stat().st_size


def manifest(
    *, scope: str, workspace: Any, requested_by: Any, schema: str | None
) -> dict[str, Any]:
    return {
        "format": FORMAT,
        "scope": scope,
        "workspace": {"id": str(workspace.id), "name": workspace.name, "slug": workspace.slug},
        "requested_by": {"id": str(requested_by.id), "display_name": requested_by.display_name},
        "exported_at": datetime.now(UTC).isoformat(),
        "schema": schema,
    }


def readme(scope: str) -> str:
    words = (
        "the workspace's public channels and its people"
        if scope == "workspace"
        else "every conversation one person is in"
    )
    emails = (
        ", with their email addresses"
        if scope == "workspace"
        else " in those conversations — your own address only"
    )
    return README.format(format=FORMAT, scope_words=words, emails=emails)


__all__ = [
    "FORMAT",
    "KEEP",
    "conversations",
    "expired",
    "fail",
    "finish",
    "forget",
    "get",
    "in_progress",
    "listing",
    "manifest",
    "messages_of",
    "people",
    "readme",
    "request",
    "start",
    "write_jsonl",
    "zip_directory",
]
