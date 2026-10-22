"""Slack imports (ADR 0042): the rows behind the admin page.

An import is a row in `imports` that moves `uploading` → `reading` → `ready` → `running`
→ `done` (or `failed`, or `cancelled`). The zip goes straight from the browser to the
bucket under `imports/<workspace>/<id>.zip`; the worker reads it (`jobs/slack_import`) and
writes what it found into `preview`; the admin chooses and starts it; the worker runs it in
steps, each committing its rows with how far it got. Only one runs at a time in a
workspace — `imports_one_running` makes that the database's rule, not a check that races.

What a step writes — people, conversations, messages — is in `services/slack_history`.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id

#: The states an import is still on its way through, before it runs.
WAITING = ("uploading", "reading", "ready")
#: How many problems one import keeps. The first ones say what is wrong; the thousandth
#: missing file says nothing the first did not.
MAX_PROBLEMS = 100

_COLUMNS = """i.id, i.workspace_id, i.requested_by, i.status, i.object_key, i.bytes,
  i.include_private, i.copy_files, i.preview, i.progress, i.cursor, i.problems, i.error,
  i.created_at, i.started_at, i.heartbeat_at, i.finished_at,
  u.display_name AS requested_by_name"""


def object_key(workspace_id: str, import_id: str) -> str:
    return f"imports/{workspace_id}/{import_id}.zip"


async def create(
    session: AsyncSession, *, workspace_id: str, requested_by: str, size_bytes: int
) -> tuple[str, list[str]]:
    """A new import waiting for its zip, and the keys of the ones it replaces.

    One that has not started yet is abandoned when another is begun: an admin who uploads
    a second zip meant the second. A running one is not touched — starting is refused
    while it runs (`imports_one_running`)."""
    replaced = (
        await session.execute(
            text(
                """
                UPDATE imports SET status = 'cancelled', finished_at = now()
                 WHERE workspace_id = :ws AND status = ANY(cast(:waiting AS text[]))
                RETURNING object_key
                """
            ),
            {"ws": workspace_id, "waiting": list(WAITING)},
        )
    ).fetchall()
    import_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO imports (id, workspace_id, requested_by, object_key, bytes)
            VALUES (:id, :ws, :by, :key, :bytes)
            """
        ),
        {
            "id": import_id,
            "ws": workspace_id,
            "by": requested_by,
            "key": object_key(workspace_id, import_id),
            "bytes": size_bytes,
        },
    )
    return import_id, [row.object_key for row in replaced]


async def get(session: AsyncSession, workspace_id: str, import_id: str) -> Any:
    return (
        await session.execute(
            text(
                f"""
                SELECT {_COLUMNS} FROM imports i JOIN users u ON u.id = i.requested_by
                 WHERE i.id = :id AND i.workspace_id = :ws
                """
            ),
            {"id": import_id, "ws": workspace_id},
        )
    ).fetchone()


async def latest(session: AsyncSession, workspace_id: str) -> Any:
    """The import the admin page shows: the newest one there is."""
    return (
        await session.execute(
            text(
                f"""
                SELECT {_COLUMNS} FROM imports i JOIN users u ON u.id = i.requested_by
                 WHERE i.workspace_id = :ws
                 ORDER BY i.created_at DESC, i.id DESC LIMIT 1
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchone()


async def lock(session: AsyncSession, import_id: str) -> Any:
    """The row, held until the transaction ends, or None when another step holds it."""
    return (
        await session.execute(
            text(
                """
                SELECT id, workspace_id, requested_by, status, object_key, include_private,
                       copy_files, preview, progress, cursor, problems
                  FROM imports WHERE id = :id
                   FOR UPDATE SKIP LOCKED
                """
            ),
            {"id": import_id},
        )
    ).fetchone()


async def move(
    session: AsyncSession, workspace_id: str, import_id: str, *, from_: str, to: str
) -> bool:
    """`from_` → `to`, only if it is still `from_`: a second press is a no-op."""
    row = (
        await session.execute(
            text(
                """
                UPDATE imports SET status = :to
                 WHERE id = :id AND workspace_id = :ws AND status = :from_
                RETURNING id
                """
            ),
            {"id": import_id, "ws": workspace_id, "from_": from_, "to": to},
        )
    ).fetchone()
    return row is not None


async def set_preview(session: AsyncSession, import_id: str, preview: dict[str, Any]) -> None:
    await session.execute(
        text(
            """
            UPDATE imports SET status = 'ready', preview = cast(:preview AS jsonb)
             WHERE id = :id AND status = 'reading'
            """
        ),
        {"id": import_id, "preview": json.dumps(preview)},
    )


async def begin(
    session: AsyncSession,
    workspace_id: str,
    import_id: str,
    *,
    include_private: bool,
    copy_files: bool,
) -> bool:
    """Ready → running, with the admin's choices. False when it was not ready."""
    row = (
        await session.execute(
            text(
                """
                UPDATE imports
                   SET status = 'running', include_private = :private, copy_files = :files,
                       started_at = now(), heartbeat_at = now(),
                       cursor = '{}'::jsonb, progress = '{}'::jsonb, problems = '[]'::jsonb
                 WHERE id = :id AND workspace_id = :ws AND status = 'ready'
                RETURNING id
                """
            ),
            {"id": import_id, "ws": workspace_id, "private": include_private, "files": copy_files},
        )
    ).fetchone()
    return row is not None


async def save_step(
    session: AsyncSession,
    import_id: str,
    *,
    cursor: dict[str, Any],
    progress: dict[str, Any],
    problems: list[str],
) -> None:
    await session.execute(
        text(
            """
            UPDATE imports
               SET cursor = cast(:cursor AS jsonb), progress = cast(:progress AS jsonb),
                   problems = cast(:problems AS jsonb), heartbeat_at = now()
             WHERE id = :id
            """
        ),
        {
            "id": import_id,
            "cursor": json.dumps(cursor),
            "progress": json.dumps(progress),
            "problems": json.dumps(problems[:MAX_PROBLEMS]),
        },
    )


async def finish(session: AsyncSession, import_id: str, *, status: str, error: str | None) -> None:
    await session.execute(
        text(
            """
            UPDATE imports SET status = :status, error = :error, finished_at = now()
             WHERE id = :id AND status = ANY(cast(:open AS text[]))
            """
        ),
        {"id": import_id, "status": status, "error": error, "open": [*WAITING, "running"]},
    )


async def cancel(session: AsyncSession, workspace_id: str, import_id: str) -> Any:
    """Stop it where it is. What it already wrote stays: an import started again carries
    on from there, and nothing it wrote is half a row."""
    return (
        await session.execute(
            text(
                """
                UPDATE imports SET status = 'cancelled', finished_at = now()
                 WHERE id = :id AND workspace_id = :ws
                   AND status = ANY(cast(:open AS text[]))
                RETURNING object_key, status
                """
            ),
            {"id": import_id, "ws": workspace_id, "open": [*WAITING, "running"]},
        )
    ).fetchone()


async def stalled(session: AsyncSession) -> list[Any]:
    """Imports whose worker went away: a step that has not been heard from in ten
    minutes, a read that never finished. The sweep queues them again."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT id, status FROM imports
                     WHERE (status = 'running' AND heartbeat_at < now() - interval '10 minutes')
                        OR (status = 'reading' AND created_at < now() - interval '15 minutes'
                            AND (heartbeat_at IS NULL
                                 OR heartbeat_at < now() - interval '15 minutes'))
                    """
                )
            )
        ).fetchall()
    )


async def abandoned(session: AsyncSession) -> list[Any]:
    """Uploads that never finished, a day on: their rows are closed and their keys
    returned so whatever did arrive can go."""
    return list(
        (
            await session.execute(
                text(
                    """
                    UPDATE imports SET status = 'cancelled', finished_at = now()
                     WHERE status = 'uploading' AND created_at < now() - interval '1 day'
                    RETURNING object_key
                    """
                )
            )
        ).fetchall()
    )
