"""Background worker.

Same image as the API, different entrypoint. It consumes the queue the send path writes
to, so a slow push provider or a hung unfurl can never delay a message.

Run with:  uv run arq blob_api.jobs.worker.WorkerSettings
"""

from __future__ import annotations

import logging
from typing import Any

from arq import cron
from sqlalchemy import text

from ..db.engine import close_engine, transaction
from ..lib.queue import redis_settings
from ..lib.redis import close_redis
from ..lib.storage import delete_object
from ..realtime import hub
from .notify import handle_notify
from .unfurl import handle_unfurl

log = logging.getLogger("blob.worker")

#: Unattached uploads are swept after this long.
ORPHAN_AGE_HOURS = 24


async def notify(_ctx: dict[str, Any], message_id: str) -> None:
    await handle_notify(message_id)


async def unfurl(_ctx: dict[str, Any], message_id: str) -> None:
    await handle_unfurl(message_id)


async def sweep_orphans(_ctx: dict[str, Any]) -> None:
    """Uploads that were started but never attached to a message."""
    async with transaction() as (session, _):
        rows = (
            await session.execute(
                text(
                    """
                    DELETE FROM attachments
                     WHERE message_id IS NULL
                       AND created_at < now() - make_interval(hours => :hours)
                    RETURNING id, object_key
                    """
                ),
                {"hours": ORPHAN_AGE_HOURS},
            )
        ).fetchall()

    for row in rows:
        try:
            await delete_object(row.object_key)
        except Exception:
            log.warning("could not delete %s", row.object_key, exc_info=True)
    if rows:
        log.info("swept %d orphaned uploads", len(rows))


async def startup(_ctx: dict[str, Any]) -> None:
    # The worker broadcasts too (read-state updates from notify), so it needs the bridge.
    await hub.start_redis_bridge()
    log.info("worker ready")


async def shutdown(_ctx: dict[str, Any]) -> None:
    await hub.stop_redis_bridge()
    await close_redis()
    await close_engine()


class WorkerSettings:
    functions = [notify, unfurl, sweep_orphans]
    # arq's stub types cron() more narrowly than it accepts at runtime.
    cron_jobs = [cron(sweep_orphans, hour=4, minute=0)]  # type: ignore[arg-type]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = redis_settings()
    max_jobs = 8
