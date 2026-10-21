"""Building an export (M3 · B4): `services/exports.py` says what goes in and why.

Read with keyset pages into JSON-lines files in a scratch directory, zipped in a thread so
the worker's other jobs keep moving, streamed into object storage, and the scratch
directory removed whatever happened. A failure is a status on the row with its reason —
somebody is waiting on the page for it — never a retry that builds the zip twice.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import storage
from ..services import exports as export_service

log = logging.getLogger("blob.jobs.export")


def object_key(workspace_id: str, export_id: str) -> str:
    return f"exports/{workspace_id}/{export_id}.zip"


async def build_export(export_id: str) -> None:
    async with transaction() as (session, _after):
        row = await export_service.get(session, export_id)
        if row is None or row.status != "pending":
            return
        await export_service.start(session, export_id)

    scratch = Path(tempfile.mkdtemp(prefix="blob-export-"))
    try:
        size = await _build(row, scratch)
        async with transaction() as (session, _after):
            await export_service.finish(
                session,
                export_id,
                object_key=object_key(str(row.workspace_id), export_id),
                size=size,
            )
    except Exception as failure:
        log.warning("export %s failed", export_id, exc_info=True)
        async with transaction() as (session, _after):
            await export_service.fail(session, export_id, error=str(failure))
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


async def _build(row: object, scratch: Path) -> int:
    workspace_id = str(row.workspace_id)  # type: ignore[attr-defined]
    scope = str(row.scope)  # type: ignore[attr-defined]
    person_id = str(row.requested_by)  # type: ignore[attr-defined]
    content = scratch / "content"
    (content / "messages").mkdir(parents=True)

    async with session_scope() as session:
        workspace = (
            await session.execute(
                text("SELECT id, name, slug FROM workspaces WHERE id = :id"), {"id": workspace_id}
            )
        ).one()
        requester = (
            await session.execute(
                text("SELECT id, display_name FROM users WHERE id = :id"), {"id": person_id}
            )
        ).one()
        schema = (
            await session.execute(text("SELECT version_num FROM alembic_version"))
        ).scalar_one_or_none()
        rooms = await export_service.conversations(
            session, workspace_id=workspace_id, scope=scope, person_id=person_id
        )
        members = {str(m) for room in rooms for m in (room.member_ids or [])} | {person_id}
        everyone = await export_service.people(
            session,
            workspace_id=workspace_id,
            scope=scope,
            person_id=person_id,
            member_ids=members,
        )
        (content / "export.json").write_text(
            json.dumps(
                export_service.manifest(
                    scope=scope, workspace=workspace, requested_by=requester, schema=schema
                ),
                indent=2,
            )
        )
        (content / "README.txt").write_text(export_service.readme(scope))
        export_service.write_jsonl(content / "users.jsonl", everyone)
        export_service.write_jsonl(
            content / "channels.jsonl",
            (
                {
                    "id": str(room.id),
                    "kind": room.kind,
                    "name": room.name,
                    "topic": room.topic,
                    "description": room.description,
                    "created_at": room.created_at.isoformat(),
                    "archived_at": room.archived_at.isoformat() if room.archived_at else None,
                    "member_ids": [str(m) for m in (room.member_ids or [])],
                }
                for room in rooms
            ),
        )
        for room in rooms:
            # Every conversation in channels.jsonl has its file, empty or not, so a reader
            # never has to ask whether a missing one means "nothing said" or "left out".
            (content / "messages" / f"{room.id}.jsonl").touch()
            batch: list[dict[str, Any]] = []
            files: list[dict[str, Any]] = []
            async for message in export_service.messages_of(session, str(room.id)):
                batch.append(message)
                for item in message["files"]:
                    files.append({**item, "message_id": message["id"], "channel_id": str(room.id)})
                if len(batch) >= export_service.PAGE:
                    export_service.write_jsonl(content / "messages" / f"{room.id}.jsonl", batch)
                    batch = []
            if batch:
                export_service.write_jsonl(content / "messages" / f"{room.id}.jsonl", batch)
            if files:
                export_service.write_jsonl(content / "files.jsonl", files)
        (content / "files.jsonl").touch()

    zipped = scratch / "export.zip"
    size = await asyncio.to_thread(export_service.zip_directory, content, zipped)
    with zipped.open("rb") as stream:
        await asyncio.to_thread(
            storage.upload_stream,
            object_key(workspace_id, str(row.id)),  # type: ignore[attr-defined]
            stream,
            bucket=settings.S3_BUCKET,
        )
    return size


async def sweep_exports(now: datetime | None = None) -> int:
    """A week after it was made, an export goes — the zip first, then its row."""
    now = now or datetime.now(UTC)
    async with session_scope() as session:
        old = await export_service.expired(session, now)
    gone = 0
    for item in old:
        if item.object_key:
            try:
                await asyncio.to_thread(
                    storage.remove_object, item.object_key, bucket=settings.S3_BUCKET
                )
            except Exception:
                log.warning("could not remove export %s; next sweep tries again", item.id)
                continue
        async with transaction() as (session, _after):
            await export_service.forget(session, str(item.id))
        gone += 1
    return gone


__all__ = ["build_export", "object_key", "sweep_exports"]
