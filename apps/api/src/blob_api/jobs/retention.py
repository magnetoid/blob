"""Forget rows that have already done their job — and, where a workspace asks, history.

Sessions expire; the resolver already ignores them. Password-reset tokens expire; the
redeem path already ignores them. Plugin deliveries that landed (or were given up on)
and audit events past the workspace's retention are the same shape: they stay forever
unless something deletes them. `sweep_retention` is that something.

`sweep_history` is the other half (ADR 0039): messages and files past the windows a
workspace chose, skipping what is on legal hold. It runs an hour after the nightly backup,
in batches, storage first and rows second, and stops for the night after `BUDGET`.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any

from sqlalchemy import text

from ..db.engine import AfterCommit, session_scope, transaction
from ..lib import storage
from ..lib.redis import redis
from ..realtime import hub
from ..services import audit as audit_service
from ..services import retention as retention_service
from ..services import workspace_settings as settings_service
from ..services.accounts import EVENT_KEEP_DAYS
from ..services.retention import Held, Policy
from ..services.workspace_settings import DEFAULT_RETENTION_DAYS, load_retention_days

log = logging.getLogger("blob.jobs.retention")

#: Rows a transaction takes, and a night's time: a first sweep over years of history
#: finishes over several nights rather than holding the database for one.
BATCH = 500
BUDGET = timedelta(minutes=20)
#: Where each walk got to, per workspace, so a night covers the day that crossed the line
#: rather than every tombstone before it. Losing one costs a full walk, nothing more.
WATERMARK = "retention:{walk}:{workspace}"
#: The last sweep's outcome per workspace, for the Retention page.
LAST = "retention:last:{workspace}"
#: Sunday's walk starts from the beginning, so what a hold kept while it applied — and a
#: person on hold has since left — is not kept for ever by a watermark already past it.
FULL_WALK_WEEKDAY = 6


@dataclass(frozen=True, slots=True)
class Walked:
    """How a walk went: how many rows went, the last one it reached, whether storage
    refused any object, and whether it got to the end or the night ran out first."""

    done: int
    reached: str | None
    refused: bool
    finished: bool


#: Delivered/dead outbox rows past this are history nobody reads.
DELIVERY_KEEP_DAYS = 30


async def sweep_retention() -> dict[str, int]:
    retention_days = await load_retention_days()
    counts = {
        "sessions": 0,
        "password_resets": 0,
        "deliveries": 0,
        "audit": 0,
        "account_events": 0,
    }
    async with transaction() as (session, _):
        counts["sessions"] = len(
            (
                await session.execute(
                    text("DELETE FROM sessions WHERE expires_at < now() RETURNING id")
                )
            ).fetchall()
        )
        counts["password_resets"] = len(
            (
                await session.execute(
                    text(
                        """
                        DELETE FROM password_resets
                         WHERE expires_at < now()
                            OR (used_at IS NOT NULL AND used_at < now() - interval '7 days')
                        RETURNING id
                        """
                    )
                )
            ).fetchall()
        )
        counts["deliveries"] = len(
            (
                await session.execute(
                    text(
                        """
                        DELETE FROM plugin_deliveries
                         WHERE status IN ('delivered', 'dead')
                           AND created_at < now() - make_interval(days => :days)
                        RETURNING id
                        """
                    ),
                    {"days": DELIVERY_KEEP_DAYS},
                )
            ).fetchall()
        )
        counts["audit"] = len(
            (
                await session.execute(
                    text(
                        """
                        DELETE FROM audit_events
                         WHERE created_at < now() - make_interval(days => :days)
                        RETURNING id
                        """
                    ),
                    {"days": retention_days or DEFAULT_RETENTION_DAYS},
                )
            ).fetchall()
        )
        # A person's own sign-in record (M3 · B1): a fixed window rather than the
        # workspace's, because it is the person's, and it spans their workspaces.
        counts["account_events"] = len(
            (
                await session.execute(
                    text(
                        """
                        DELETE FROM account_events
                         WHERE created_at < now() - make_interval(days => :days)
                        RETURNING id
                        """
                    ),
                    {"days": EVENT_KEEP_DAYS},
                )
            ).fetchall()
        )
    removed = sum(counts.values())
    if removed:
        log.info("swept expired rows: %s", counts)
    return counts


async def _watermark(walk: str, workspace_id: str) -> str | None:
    try:
        raw = await redis.get(WATERMARK.format(walk=walk, workspace=workspace_id))
    except Exception:
        log.warning("could not read the %s watermark; walking from the start", walk)
        return None
    if raw is None:
        return None
    return raw.decode() if isinstance(raw, bytes) else str(raw)


async def _set_watermark(walk: str, workspace_id: str, value: str) -> None:
    try:
        await redis.set(WATERMARK.format(walk=walk, workspace=workspace_id), value)
    except Exception:
        log.warning("could not keep the %s watermark", walk, exc_info=True)


async def forget_watermarks(workspace_id: str) -> None:
    """Start every walk from the beginning: after a window changes or a hold is released,
    what was skipped below the watermarks may be due now."""
    try:
        await redis.delete(
            *(
                WATERMARK.format(walk=walk, workspace=workspace_id)
                for walk in ("messages", "pictures")
            )
        )
    except Exception:
        log.warning("could not reset the retention watermarks", exc_info=True)


async def last_sweep(workspace_id: str) -> dict[str, Any] | None:
    """What the last sweep of this workspace did, if Redis still remembers."""
    try:
        raw = await redis.get(LAST.format(workspace=workspace_id))
    except Exception:
        return None
    if raw is None:
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _announce(
    after: AfterCommit,
    changed: list[tuple[str, str]],
    last_message: dict[str, str | None] | None = None,
) -> None:
    """One frame per conversation, naming the newest message changed in it: everything up
    to it is gone or changed, and only a client holding that far back refetches. Where the
    conversation's newest message went, the frame says what is newest now — the client
    keeps the same pointer, and a stale one drops every later live message."""
    through: dict[str, str] = {}
    for channel_id, message_id in changed:
        if message_id > through.get(channel_id, ""):
            through[channel_id] = message_id
    for channel_id, newest in through.items():
        frame: dict[str, Any] = {"t": "history.trimmed", "channelId": channel_id, "through": newest}
        if last_message and channel_id in last_message:
            frame["lastMessageId"] = last_message[channel_id]
        after.add(partial(hub.to_channel, channel_id, frame))


async def _walk(
    workspace_id: str,
    *,
    fetch: Callable[[str | None, Held], Awaitable[list[Any]]],
    keys_of: Callable[[Any], list[str]],
    apply: Callable[[Any, AfterCommit, list[Any]], Awaitable[int]],
    position: Callable[[Any], str],
    deadline: float,
    start: str | None,
) -> Walked:
    """Batches until nothing is left or the night's time is up: fetch, delete the objects,
    then — for the rows whose objects all went — the rows."""
    after = start
    done = 0
    refused = False
    while time.monotonic() < deadline:
        async with session_scope() as session:
            held = await retention_service.held_scope(session, workspace_id)
        batch = await fetch(after, held)
        if not batch:
            return Walked(done, after, refused, finished=True)
        keys = [key for row in batch for key in keys_of(row)]
        failed = await storage.delete_objects(keys) if keys else set()
        ready = [row for row in batch if not set(keys_of(row)) & failed]
        refused = refused or len(ready) < len(batch)
        if ready:
            async with transaction() as (session, after_commit):
                done += await apply(session, after_commit, ready)
        after = position(batch[-1])
        if len(batch) < BATCH:
            return Walked(done, after, refused, finished=True)
    return Walked(done, after, refused, finished=False)


async def _keep_place(walk: str, workspace_id: str, walked: Walked, line: str) -> None:
    """Move a walk's watermark to where it got: the line, if it finished; the last row it
    reached, if the night ran out. Never past a file storage refused to delete — that row
    is tried again tomorrow — and never anywhere when the walk never started."""
    if walked.refused:
        return
    if walked.finished:
        await _set_watermark(walk, workspace_id, line)
    elif walked.reached is not None:
        await _set_watermark(walk, workspace_id, walked.reached)


async def _messages(
    workspace_id: str, line: str, *, full: bool, deadline: float
) -> tuple[int, int]:
    """Live messages past the message line become tombstones. (messages, files)"""
    files = 0

    async def fetch(after: str | None, held: Held) -> list[Any]:
        async with session_scope() as session:
            return await retention_service.messages_past(
                session, workspace_id, line=line, after=after, held=held, limit=BATCH
            )

    def keys_of(row: Any) -> list[str]:
        return [*(row.object_keys or []), *([row.picture_key] if row.picture_key else [])]

    async def apply(session: Any, after: AfterCommit, rows: list[Any]) -> int:
        nonlocal files
        swept = await retention_service.tombstone(session, [str(row.id) for row in rows])
        went = {str(row.id) for row in swept.rows}
        files += sum(row.file_count for row in rows if str(row.id) in went)
        _announce(
            after,
            [(str(row.channel_id), str(row.id)) for row in swept.rows],
            swept.last_message,
        )
        return len(swept.rows)

    start = None if full else await _watermark("messages", workspace_id)
    walked = await _walk(
        workspace_id,
        fetch=fetch,
        keys_of=keys_of,
        apply=apply,
        position=lambda row: str(row.id),
        deadline=deadline,
        start=start,
    )
    await _keep_place("messages", workspace_id, walked, line)
    return walked.done, files


async def _files(workspace_id: str, line: str, *, deadline: float) -> int:
    """Files past the file line, from messages that keep their words — and from deleted
    messages, whose delete left them behind. No watermark: a row goes once it is done, so
    what is left to walk is what is held."""

    async def fetch(after: str | None, held: Held) -> list[Any]:
        async with session_scope() as session:
            return await retention_service.files_past(
                session, workspace_id, line=line, after=after, held=held, limit=BATCH
            )

    async def apply(session: Any, after: AfterCommit, rows: list[Any]) -> int:
        await retention_service.drop_files(session, rows)
        _announce(
            after, [(str(row.channel_id), str(row.message_id)) for row in rows if not row.deleted]
        )
        return sum(len(row.attachment_ids) for row in rows)

    walked = await _walk(
        workspace_id,
        fetch=fetch,
        keys_of=lambda row: list(row.object_keys or []),
        apply=apply,
        position=lambda row: str(row.message_id),
        deadline=deadline,
        start=None,
    )
    return walked.done


async def _pictures(workspace_id: str, line: str, *, full: bool, deadline: float) -> int:
    """Link previews' pictures past the file line."""

    async def fetch(after: str | None, held: Held) -> list[Any]:
        async with session_scope() as session:
            return await retention_service.pictures_past(
                session, workspace_id, line=line, after=after, held=held, limit=BATCH
            )

    async def apply(session: Any, after: AfterCommit, rows: list[Any]) -> int:
        await retention_service.drop_pictures(session, [str(row.id) for row in rows])
        _announce(after, [(str(row.channel_id), str(row.id)) for row in rows if not row.deleted])
        return len(rows)

    start = None if full else await _watermark("pictures", workspace_id)
    walked = await _walk(
        workspace_id,
        fetch=fetch,
        keys_of=lambda row: [row.picture_key],
        apply=apply,
        position=lambda row: str(row.id),
        deadline=deadline,
        start=start,
    )
    await _keep_place("pictures", workspace_id, walked, line)
    return walked.done


async def _sweep_workspace(
    workspace_id: str, policy: Policy, now: datetime, *, full: bool, deadline: float
) -> dict[str, int]:
    counts = {"messages": 0, "files": 0, "previews": 0, "agentRuns": 0, "agentMemory": 0}
    if policy.message_days is not None:
        cutoff = now - timedelta(days=policy.message_days)
        counts["messages"], counts["files"] = await _messages(
            workspace_id, retention_service.line_id(cutoff), full=full, deadline=deadline
        )
        async with transaction() as (session, _):
            held = await retention_service.held_scope(session, workspace_id)
            (
                counts["agentRuns"],
                counts["agentMemory"],
            ) = await retention_service.forget_agent_records(
                session, workspace_id, cutoff=cutoff, held=held
            )
    if policy.file_window is not None:
        line = retention_service.line_id(now - timedelta(days=policy.file_window))
        counts["files"] += await _files(workspace_id, line, deadline=deadline)
        counts["previews"] = await _pictures(workspace_id, line, full=full, deadline=deadline)
    return counts


async def sweep_history(
    *, now: datetime | None = None, full: bool | None = None, budget: timedelta = BUDGET
) -> dict[str, dict[str, int]]:
    """Every workspace with a window in force, until the night's time runs out. Each one's
    outcome is kept for its Retention page, and recorded in its audit log when anything
    went."""
    now = now or datetime.now(UTC)
    full = now.weekday() == FULL_WALK_WEEKDAY if full is None else full
    deadline = time.monotonic() + budget.total_seconds()
    async with session_scope() as session:
        rows = (
            await session.execute(text("SELECT workspace_id, settings FROM workspace_settings"))
        ).fetchall()
    outcomes: dict[str, dict[str, int]] = {}
    for row in rows:
        policy = retention_service.from_settings(settings_service.parse(row.settings))
        if not policy.enabled or not policy.in_force(now):
            continue
        workspace_id = str(row.workspace_id)
        counts = await _sweep_workspace(workspace_id, policy, now, full=full, deadline=deadline)
        outcomes[workspace_id] = counts
        try:
            await redis.set(
                LAST.format(workspace=workspace_id),
                json.dumps({"at": now.isoformat(), **counts}),
            )
        except Exception:
            log.warning("could not keep the retention outcome", exc_info=True)
        if any(counts.values()):
            async with transaction() as (session, _):
                await audit_service.record_system(
                    session,
                    workspace_id,
                    "retention.swept",
                    metadata={kind: n for kind, n in counts.items() if n},
                )
            log.info("retention swept %s: %s", workspace_id, counts)
        if time.monotonic() >= deadline:
            log.info("retention sweep stopped for the night; the next one carries on")
            break
    return outcomes
