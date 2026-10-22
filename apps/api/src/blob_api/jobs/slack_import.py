"""Running a Slack import (ADR 0042): reading the zip, then taking it in steps.

`read` fetches the zip from the bucket into the worker's own `SLACK_IMPORT_DIR` once,
checks it, and writes what it holds into the import's preview. `step` runs for about two
minutes: the first one finds or makes everybody and every conversation, and each after it
writes messages a batch at a time — each batch committed together with how far it got —
then queues the next step. A step a deploy killed is queued again by `sweep`, and starts
where its last batch ended; one that runs twice finds its rows already there.

A file is copied only from `https://files.slack.com/`, every hop pinned to the address
that was checked (`lib/net.pin_public`). Its link carries Slack's access token, so no URL
is logged, stored or shown — a failure is reported by the file's name — and the zip,
which holds every one of those tokens, is deleted when the import ends.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import images, magic, storage
from ..lib.mail import send_mail
from ..lib.net import pin_public
from ..lib.queue import enqueue, fire_and_forget
from ..lib.slack_export import ExportError, SlackConversation, SlackExport, open_export
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import slack_history as history
from ..services import slack_import as import_service
from ..services.workspace_settings import load as load_settings

log = logging.getLogger(__name__)

#: How long one step runs before it hands over to the next. Well inside the job's own
#: ceiling (`jobs/worker.py`), with room for the file being fetched when time runs out.
STEP_SECONDS = 120.0
#: Messages written per transaction.
BATCH = 200
#: One file's fetch, end to end.
FETCH_TIMEOUT_SEC = 60.0
MAX_REDIRECTS = 3
#: The only place a Slack file is fetched from. Its link carries a token, and a name in a
#: zip anybody can write is not a reason to send a request anywhere else.
FILE_HOST = "files.slack.com"
#: How many conversations' members are told one by one that a conversation arrived.
#: Past it, they see the new conversations when the app next loads.
MAX_ANNOUNCED_VIEWS = 5_000


# ─── the zip ─────────────────────────────────────────────────────────────────────────


def _local(import_id: str) -> Path:
    return Path(settings.SLACK_IMPORT_DIR) / f"{import_id}.zip"


def _fetch_local(import_id: str, key: str, size: int | None) -> Path:
    """Blocking: the worker's copy of the zip, fetched once and kept while it runs."""
    path = _local(import_id)
    if path.exists() and (size is None or path.stat().st_size == size):
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    storage.download_to(key, str(partial), bucket=settings.S3_BUCKET)
    partial.replace(path)
    return path


def forget_local(import_id: str) -> None:
    for candidate in (_local(import_id), _local(import_id).with_suffix(".part")):
        candidate.unlink(missing_ok=True)


async def _open(import_id: str, key: str, size: int | None) -> SlackExport:
    path = await asyncio.to_thread(_fetch_local, import_id, key, size)
    return await asyncio.to_thread(open_export, str(path))


# ─── reading ─────────────────────────────────────────────────────────────────────────


async def read(import_id: str) -> None:
    async with transaction() as (session, _):
        row = await import_service.lock(session, import_id)
        if row is None or row.status != "reading":
            return
        await session.execute(
            text("UPDATE imports SET heartbeat_at = now() WHERE id = :id"), {"id": import_id}
        )
        key, workspace_id = row.object_key, str(row.workspace_id)
        size = (
            await session.execute(
                text("SELECT bytes FROM imports WHERE id = :id"), {"id": import_id}
            )
        ).scalar_one()
    try:
        export = await _open(import_id, key, size)
    except ExportError as error:
        await _fail(import_id, str(error), key)
        return
    except Exception:
        log.exception("an import's zip could not be read")
        await _fail(import_id, "The zip could not be read. Upload it again.", key)
        return
    try:
        async with transaction() as (session, _):
            preview = await _preview(session, workspace_id, export)
            await import_service.set_preview(session, import_id, preview)
    finally:
        export.close()


async def _preview(session: Any, workspace_id: str, export: SlackExport) -> dict[str, Any]:
    kinds = {"public": 0, "private": 0, "dm": 0, "group_dm": 0}
    days = {"public": 0, "private": 0}
    for conversation in export.conversations:
        kinds[conversation.kind] += 1
        days["public" if conversation.kind == "public" else "private"] += len(conversation.days)
    people = [u for u in export.users.values() if not u.is_bot and not u.deleted]
    addresses = [u.email for u in people if u.email]
    here = {
        row.email.lower()
        for row in (
            await session.execute(
                text(
                    """
                    SELECT email FROM users
                     WHERE workspace_id = :ws AND NOT placeholder
                       AND email = ANY(cast(:emails AS citext[]))
                    """
                ),
                {"ws": workspace_id, "emails": addresses},
            )
        ).fetchall()
    }
    public_here = {
        row.name
        for row in (
            await session.execute(
                text(
                    """
                    SELECT lower(name) AS name FROM channels
                     WHERE workspace_id = :ws AND kind = 'public'
                    """
                ),
                {"ws": workspace_id},
            )
        ).fetchall()
    }
    merging = sorted(
        {
            history.channel_name(c.name)
            for c in export.conversations
            if c.kind == "public" and c.name and history.channel_name(c.name) in public_here
        }
    )
    matched = sum(1 for u in people if u.email and u.email in here)
    return {
        "public_channels": kinds["public"],
        "private_channels": kinds["private"],
        "direct_messages": kinds["dm"],
        "group_messages": kinds["group_dm"],
        "public_days": days["public"],
        "private_days": days["private"],
        "people": len(people),
        "matched": matched,
        "placeholders": len(people) - matched,
        "without_address": sum(1 for u in people if not u.email),
        "apps": sum(1 for u in export.users.values() if u.is_bot),
        "merging": merging[:50],
    }


async def _fail(import_id: str, error: str, key: str) -> None:
    async with transaction() as (session, after):
        await import_service.finish(session, import_id, status="failed", error=error[:500])
        after.add(lambda: fire_and_forget(storage.delete_object(key)))
    forget_local(import_id)


# ─── a step ──────────────────────────────────────────────────────────────────────────


@dataclass
class _State:
    import_id: str
    workspace_id: str
    requested_by: str
    copy_files: bool
    include_private: bool
    cursor: dict[str, Any]
    progress: dict[str, Any]
    problems: list[str]

    def problem(self, words: str) -> None:
        if len(self.problems) < import_service.MAX_PROBLEMS:
            self.problems.append(words)


async def step(import_id: str) -> None:
    async with transaction() as (session, _):
        row = await import_service.lock(session, import_id)
        if row is None or row.status != "running":
            return
        await session.execute(
            text("UPDATE imports SET heartbeat_at = now() WHERE id = :id"), {"id": import_id}
        )
        size = (
            await session.execute(
                text("SELECT bytes FROM imports WHERE id = :id"), {"id": import_id}
            )
        ).scalar_one()
    state = _State(
        import_id=import_id,
        workspace_id=str(row.workspace_id),
        requested_by=str(row.requested_by),
        copy_files=bool(row.copy_files),
        include_private=bool(row.include_private),
        cursor=dict(row.cursor or {}),
        progress=dict(row.progress or {}),
        problems=[str(p) for p in (row.problems or [])],
    )
    try:
        export = await _open(import_id, row.object_key, size)
    except ExportError as error:
        await _fail(import_id, str(error), row.object_key)
        return
    try:
        finished = await _run(state, export, deadline=time.monotonic() + STEP_SECONDS)
    except Exception:
        log.exception("a Slack import step failed")
        await _fail(
            import_id,
            "The import stopped on something it could not handle. What it wrote stays; "
            "starting it again carries on from there.",
            row.object_key,
        )
        return
    finally:
        export.close()
    if finished is None:
        return
    if finished:
        forget_local(import_id)
    else:
        await enqueue("slack_import_step", import_id)


async def _run(state: _State, export: SlackExport, *, deadline: float) -> bool | None:
    """True when the import is done, False when time ran out first, None when this step
    is no longer the one running it (cancelled, or another step got ahead)."""
    if not state.cursor.get("setup"):
        if not await _setup(state, export):
            return None
    async with session_scope() as session:
        placed = await history.placed_conversations(session, state.import_id)
        people = await history.load_people(session, state.import_id)
        names = await _names(session, people)
        channel_names = await _channel_names(session, placed)
    conversations = {c.id: c for c in export.conversations}
    while time.monotonic() < deadline:
        index = int(state.cursor.get("conversation", 0))
        if index >= len(placed):
            return await _finish(state, placed)
        here = placed[index]
        conversation = conversations.get(here.slack_id)
        day = int(state.cursor.get("day", 0))
        if conversation is None or day >= len(conversation.days):
            moved = await _commit(
                state,
                {"conversation": index + 1, "day": 0, "row": 0},
                settle=(here.channel_id, here.created),
                conversations_done=1,
            )
            if not moved:
                return None
            continue
        offset = int(state.cursor.get("row", 0))
        messages = await asyncio.to_thread(export.messages, conversation, conversation.days[day])
        chunk = messages[offset : offset + BATCH]
        strangers = {
            author: message
            for message in chunk
            if (author := history.author_of(message)) and author not in people.ids
        }
        if strangers:
            async with transaction() as (session, _):
                await history.map_people(
                    session,
                    workspace_id=state.workspace_id,
                    import_id=state.import_id,
                    users=[
                        export.users.get(author) or history.stranger(author, message)
                        for author, message in strangers.items()
                    ],
                    people=people,
                )
            async with session_scope() as session:
                names = await _names(session, people)
        rows = [
            row
            for message in chunk
            if (
                row := history.to_row(
                    message,
                    workspace_id=state.workspace_id,
                    conversation=conversation.id,
                    channel_id=here.channel_id,
                    people=people,
                    names=names,
                    channels=channel_names,
                )
            )
            is not None
        ]
        notes = await _copy_files(state, conversation, rows)
        next_cursor = (
            {"conversation": index, "day": day, "row": offset + BATCH}
            if offset + BATCH < len(messages)
            else {"conversation": index, "day": day + 1, "row": 0}
        )
        moved = await _commit(state, next_cursor, rows=rows, notes=notes, conversation=conversation)
        if not moved:
            return None
    return False


async def _commit(
    state: _State,
    cursor: dict[str, Any],
    *,
    rows: list[history.Row] | None = None,
    notes: dict[str, list[history.FileNote]] | None = None,
    conversation: SlackConversation | None = None,
    settle: tuple[str, bool] | None = None,
    conversations_done: int = 0,
) -> bool:
    """Write a batch and move the cursor past it, in one transaction — or nothing, when
    the import was cancelled or another step has moved the cursor since this one read it."""
    async with transaction() as (session, _):
        row = await import_service.lock(session, state.import_id)
        if (
            row is None
            or row.status != "running"
            or _position(row.cursor) != _position(state.cursor)
        ):
            return False
        if rows and conversation is not None:
            written = await history.write_rows(
                session,
                workspace_id=state.workspace_id,
                conversation=conversation.id,
                rows=rows,
                notes=notes or {},
            )
            _count(state, "messages", written)
        if settle is not None:
            await history.settle(session, settle[0], created=settle[1])
        _count(state, "conversations", conversations_done)
        state.cursor = {**state.cursor, **cursor}
        await import_service.save_step(
            session,
            state.import_id,
            cursor=state.cursor,
            progress=state.progress,
            problems=state.problems,
        )
    return True


def _position(cursor: Any) -> tuple[int, int, int]:
    cursor = cursor or {}
    return (
        int(cursor.get("conversation", 0)),
        int(cursor.get("day", 0)),
        int(cursor.get("row", 0)),
    )


def _count(state: _State, key: str, by: int) -> None:
    state.progress[key] = int(state.progress.get(key, 0)) + by


async def _setup(state: _State, export: SlackExport) -> bool:
    """Everybody, then every conversation the admin chose, found or made — in one
    transaction, so a setup that fails leaves nothing behind."""
    kinds = {"public"} | ({"private", "dm", "group_dm"} if state.include_private else set())
    chosen = sorted(
        (c for c in export.conversations if c.kind in kinds),
        key=lambda c: (("public", "private", "group_dm", "dm").index(c.kind), c.name or c.id),
    )
    async with transaction() as (session, _):
        row = await import_service.lock(session, state.import_id)
        if row is None or row.status != "running" or (row.cursor or {}).get("setup"):
            return False
        people = history.People()
        # People now, apps when a message of theirs turns up: an app that never posted
        # would be a name on nothing, and Slack lists one twice — as a user and as a bot.
        await history.map_people(
            session,
            workspace_id=state.workspace_id,
            import_id=state.import_id,
            users=[user for user in export.users.values() if not user.is_bot],
            people=people,
        )
        placed = await history.place_conversations(
            session,
            workspace_id=state.workspace_id,
            import_id=state.import_id,
            conversations=chosen,
            people=people,
            fallback_creator=state.requested_by,
        )
        state.progress.update(
            {
                "conversations": 0,
                "conversations_total": len(placed),
                "people_created": people.created,
                "people_matched": people.matched,
            }
        )
        state.cursor = {"setup": True, "conversation": 0, "day": 0, "row": 0}
        await import_service.save_step(
            session,
            state.import_id,
            cursor=state.cursor,
            progress=state.progress,
            problems=state.problems,
        )
    return True


async def _names(session: Any, people: history.People) -> dict[str, str]:
    """What each Slack account is called here, for the mentions in what they wrote."""
    if not people.ids:
        return {}
    rows = (
        await session.execute(
            text("SELECT id, display_name FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
            {"ids": list(set(people.ids.values()))},
        )
    ).fetchall()
    by_id = {str(row.id): row.display_name for row in rows}
    return {slack: by_id[user] for slack, user in people.ids.items() if user in by_id}


async def _channel_names(session: Any, placed: list[history.Placed]) -> dict[str, str]:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, name FROM channels
                 WHERE id = ANY(cast(:ids AS uuid[])) AND name IS NOT NULL
                """
            ),
            {"ids": [p.channel_id for p in placed]},
        )
    ).fetchall()
    by_id = {str(row.id): row.name for row in rows}
    return {p.slack_id: by_id[p.channel_id] for p in placed if p.channel_id in by_id}


# ─── files ───────────────────────────────────────────────────────────────────────────


async def _copy_files(
    state: _State, conversation: SlackConversation, rows: list[history.Row]
) -> dict[str, list[history.FileNote]]:
    notes: dict[str, list[history.FileNote]] = {}
    wanted = [(row, f) for row in rows for f in row.files]
    if not wanted:
        return notes
    ids = {
        id(f): history.attachment_id(state.workspace_id, conversation.id, row.ts, str(f["id"]))
        for row, f in wanted
        if isinstance(f.get("id"), str)
    }
    async with session_scope() as session:
        have = await history.existing_attachments(session, list(ids.values()))
    limit = min(
        settings.SLACK_IMPORT_MAX_FILE_BYTES,
        (await load_settings(state.workspace_id)).upload_limit_bytes,
    )
    for row, slack_file in wanted:
        attachment = ids.get(id(slack_file))
        if attachment is not None and attachment in have:
            notes.setdefault(row.id, []).append(history.FileNote(attachment_id=attachment))
            continue
        name = _file_name(slack_file)
        refusal = _refusal(slack_file, name, copy=state.copy_files, limit=limit)
        if refusal is None and attachment is None:
            refusal = f"📎 {name} could not be copied from Slack."
        if refusal is not None or attachment is None:
            notes.setdefault(row.id, []).append(history.FileNote(line=refusal))
            _count(state, "files_skipped", 1)
            continue
        stored = await _store(state, row, slack_file, name, attachment, limit)
        if stored is None:
            notes.setdefault(row.id, []).append(
                history.FileNote(line=f"📎 {name} could not be fetched from Slack.")
            )
            state.problem(f"{name} in {_where(conversation)} could not be fetched from Slack.")
            _count(state, "files_skipped", 1)
        elif isinstance(stored, str):
            notes.setdefault(row.id, []).append(history.FileNote(line=stored))
            _count(state, "files_skipped", 1)
        else:
            notes.setdefault(row.id, []).append(history.FileNote(attachment_id=attachment))
            _count(state, "files_copied", 1)
    return notes


def _where(conversation: SlackConversation) -> str:
    return (
        f"#{conversation.name}"
        if conversation.kind in ("public", "private") and conversation.name
        else "a direct message"
    )


def _file_name(slack_file: dict[str, Any]) -> str:
    for key in ("name", "title"):
        value = slack_file.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:200]
    return "A file"


def _megabytes(size: int) -> str:
    return f"{size / (1024 * 1024):.0f} MB"


def _refusal(slack_file: dict[str, Any], name: str, *, copy: bool, limit: int) -> str | None:
    """Why this file stays in Slack, as the line its message gets — or None."""
    mode = slack_file.get("mode")
    if mode == "tombstone" or slack_file.get("is_deleted"):
        return f"📎 {name} was deleted in Slack."
    if mode == "hidden_by_limit":
        return f"📎 {name} was hidden by Slack's plan, so it could not be copied."
    if slack_file.get("is_external") or mode == "external":
        link = slack_file.get("url_private")
        if (
            isinstance(link, str)
            and urlsplit(link).scheme == "https"
            and urlsplit(link).hostname != FILE_HOST
        ):
            return f"📎 [{name}]({link}) is kept outside Slack."
        return f"📎 {name} is kept outside Slack and was not copied."
    if not copy:
        return f"📎 {name} was not copied from Slack."
    size = slack_file.get("size")
    if isinstance(size, int) and size > limit:
        return f"📎 {name} was not copied from Slack: it is larger than {_megabytes(limit)}."
    if magic.blocked_extension(name):
        return f"📎 {name} was not copied: files of that kind can't be shared here."
    url = slack_file.get("url_private_download") or slack_file.get("url_private")
    if (
        not isinstance(url, str)
        or urlsplit(url).scheme != "https"
        or urlsplit(url).hostname != FILE_HOST
    ):
        return f"📎 {name} could not be copied from Slack."
    return None


async def _store(
    state: _State,
    row: history.Row,
    slack_file: dict[str, Any],
    name: str,
    attachment: str,
    limit: int,
) -> bool | str | None:
    """Fetch, check and keep one file. True when kept, a line when its bytes were
    refused, None when it could not be fetched."""
    url = slack_file.get("url_private_download") or slack_file.get("url_private")
    data = await fetch(url, limit) if isinstance(url, str) else None
    if data is None:
        return None
    mime = magic.claimed_mime(str(slack_file.get("mimetype") or "application/octet-stream"))
    reason = magic.reject_reason(data[: magic.HEAD_BYTES], mime)
    if reason:
        return f"📎 {name} was not copied: {reason[:1].lower()}{reason[1:]}"
    if mime == "image/jpeg":
        cleaned = await asyncio.to_thread(images.without_location, data)
        if cleaned is not None:
            data = cleaned
    key = storage.build_object_key(state.workspace_id, name)
    try:
        await storage.put_object(key, data, mime)
    except Exception:
        log.warning("could not store an imported file %s", attachment, exc_info=True)
        return None
    thumb_key: str | None = None
    width = height = None
    if images.can_thumbnail(mime, len(data)):
        rendered = await asyncio.to_thread(images.render, data)
        if rendered is not None:
            candidate = images.thumb_key_for(key)
            try:
                await storage.put_object(candidate, rendered.thumb, rendered.thumb_mime)
                thumb_key, width, height = candidate, rendered.width, rendered.height
            except Exception:
                log.warning("could not store a thumbnail for %s", attachment, exc_info=True)
    async with transaction() as (session, _):
        await history.record_attachment(
            session,
            attachment_id=attachment,
            workspace_id=state.workspace_id,
            uploader_id=row.author_id or state.requested_by,
            object_key=key,
            thumb_key=thumb_key,
            filename=name,
            mime=mime,
            size_bytes=len(data),
            width=width,
            height=height,
            created_at=row.created_at,
        )
    return True


async def fetch(url: str, limit: int) -> bytes | None:
    """A Slack file's bytes, or None. Only from `files.slack.com`, every hop pinned and
    checked, never past `limit`. Nothing about the URL is logged: it carries a token."""
    if urlsplit(url).scheme != "https" or urlsplit(url).hostname != FILE_HOST:
        return None
    try:
        async with httpx.AsyncClient(
            timeout=FETCH_TIMEOUT_SEC,
            follow_redirects=False,
            headers={"user-agent": "blob-import/1.0"},
        ) as client:
            current = url
            for _hop in range(MAX_REDIRECTS + 1):
                pinned = await pin_public(current)
                if pinned is None or urlsplit(current).scheme != "https":
                    return None
                async with client.stream(
                    "GET", pinned.url, headers=pinned.headers, extensions=pinned.extensions
                ) as response:
                    if response.is_redirect:
                        location = response.headers.get("location")
                        if not location:
                            return None
                        current = str(httpx.URL(current).join(location))
                        continue
                    if response.status_code != 200:
                        return None
                    declared = response.headers.get("content-length")
                    if declared and declared.isdigit() and int(declared) > limit:
                        return None
                    body = bytearray()
                    async for piece in response.aiter_bytes():
                        body.extend(piece)
                        if len(body) > limit:
                            return None
                    return bytes(body)
            return None
    except httpx.HTTPError as error:
        # The class alone: an httpx message can carry the URL, and the URL is a key.
        log.info("a Slack file could not be fetched (%s)", type(error).__name__)
        return None


# ─── finishing ───────────────────────────────────────────────────────────────────────


async def _finish(state: _State, placed: list[history.Placed]) -> bool | None:
    async with transaction() as (session, after):
        row = await import_service.lock(session, state.import_id)
        if row is None or row.status != "running":
            return None
        key = row.object_key
        await import_service.save_step(
            session,
            state.import_id,
            cursor=state.cursor,
            progress=state.progress,
            problems=state.problems,
        )
        await import_service.finish(session, state.import_id, status="done", error=None)
        await audit_service.record_system(
            session,
            state.workspace_id,
            "import.finished",
            metadata={"source": "slack", **state.progress},
        )
        await _announce(session, after, state.workspace_id, [p for p in placed if p.created])
        after.add(lambda: fire_and_forget(storage.delete_object(key)))
    return True


async def _announce(
    session: Any, after: Any, workspace_id: str, created: list[history.Placed]
) -> None:
    """Tell the people already here about the conversations that are new to them, as
    creating one does — past COMMIT, each member their own standing in it."""
    budget = MAX_ANNOUNCED_VIEWS
    for placed in created:
        members = [
            str(r.user_id)
            for r in (
                await session.execute(
                    text(
                        """
                        SELECT cm.user_id FROM channel_members cm
                          JOIN users u ON u.id = cm.user_id
                         WHERE cm.channel_id = :channel AND u.deactivated_at IS NULL
                        """
                    ),
                    {"channel": placed.channel_id},
                )
            ).fetchall()
        ]
        if not members or budget < len(members):
            continue
        budget -= len(members)
        views = {
            member: await channel_service.get_for_user(session, placed.channel_id, member)
            for member in members
        }
        channel = next((view for view in views.values() if view is not None), None)
        if channel is None:
            continue
        channel_service.announce_created(
            after,
            channel,
            channel_id=placed.channel_id,
            members=members,
            views=views,
            workspace_id=workspace_id if channel.kind == "public" else None,
        )


# ─── the sweep, and the invitations' mail ────────────────────────────────────────────


async def sweep() -> None:
    """Steps and reads whose worker went away are queued again; uploads that never
    finished are closed and their objects removed; copies of zips no import needs go."""
    async with transaction() as (session, after):
        stalled = await import_service.stalled(session)
        abandoned = await import_service.abandoned(session)
        live = {
            str(row.id)
            for row in (
                await session.execute(
                    text(
                        """
                        SELECT id FROM imports
                         WHERE status IN ('uploading', 'reading', 'ready', 'running')
                        """
                    )
                )
            ).fetchall()
        }
        keys = [row.object_key for row in abandoned]

        def drop() -> None:
            for key in keys:
                fire_and_forget(storage.delete_object(key))

        after.add(drop)
    for row in stalled:
        await enqueue(
            "slack_import_step" if row.status == "running" else "slack_import_read", str(row.id)
        )
    await asyncio.to_thread(_drop_local_copies, live)


def _drop_local_copies(live: set[str]) -> None:
    """Blocking: the worker's copies of zips no import is still using."""
    folder = Path(settings.SLACK_IMPORT_DIR)
    if folder.is_dir():
        for path in folder.iterdir():
            if path.name.split(".")[0] not in live:
                path.unlink(missing_ok=True)


async def send_invite_mail(job: dict[str, str]) -> None:
    """An invitation to somebody an import brought over: their history is waiting."""
    await send_mail(
        job["to"],
        f"{job['inviter']} invited you to {job['workspace']}",
        f"{job['inviter']} invited you to join {job['workspace']} on Blob.\n\n"
        "Your messages from Slack are already there, in the channels and conversations "
        "you were in.\n\n"
        f"Accept the invitation:\n{job['url']}\n\nThe link expires in two weeks.",
    )
