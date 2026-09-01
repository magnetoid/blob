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
from ..lib.queue import close_queue, redis_settings
from ..lib.redis import close_redis
from ..lib.storage import delete_object
from ..plugins import delivery as plugin_delivery
from ..realtime import hub
from ..services import agent_runs as agent_run_service
from .agui import handle_agui_run
from .deployments import sync_hosted_agents
from .notify import handle_notify
from .reminders import fire_reminders
from .scheduled import send_scheduled
from .unfurl import handle_unfurl

log = logging.getLogger("blob.worker")

#: Unattached uploads are swept after this long.
ORPHAN_AGE_HOURS = 24


async def notify(_ctx: dict[str, Any], message_id: str) -> None:
    await handle_notify(message_id)


async def unfurl(_ctx: dict[str, Any], message_id: str) -> None:
    await handle_unfurl(message_id)


async def agui_run(_ctx: dict[str, Any], message_id: str) -> None:
    """Answer a mention of an AG-UI app's bot.

    No cron behind this one, unlike the plugin outbox: there is no durable table of owed
    runs, and re-running an agent an hour late is worse than not running it at all.
    """
    await handle_agui_run(message_id)


async def sweep_agent_runs(_ctx: dict[str, Any]) -> None:
    """Retention for the agent run log.

    Every mention of an agent writes a row and nothing else would ever remove one, so
    this table is unbounded by construction. The sweep also closes runs still marked
    `running` well past any timeout — a process killed mid-call leaves one, and a row
    that claims to still be going is worse than one that admits it never finished.
    """
    async with transaction() as (session, _):
        removed = await agent_run_service.sweep(session)
    if removed:
        log.info("swept %d agent run(s)", removed)


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


async def deliver_plugin_events(_ctx: dict[str, Any]) -> None:
    """Drain the plugin outbox.

    Enqueued after every event so delivery is prompt, and also run on a timer so a lost
    enqueue delays events rather than losing them — the queue is a latency optimisation,
    the table is the source of truth.
    """
    delivered = await plugin_delivery.drain()
    if delivered:
        log.info("attempted %d plugin deliveries", delivered)


async def startup(_ctx: dict[str, Any]) -> None:
    # The worker broadcasts too (read-state updates from notify), so it needs the bridge.
    await hub.start_redis_bridge()
    log.info("worker ready")


async def shutdown(_ctx: dict[str, Any]) -> None:
    await hub.stop_redis_bridge()
    await plugin_delivery.close_client()
    await close_queue()
    await close_redis()
    await close_engine()


class WorkerSettings:
    functions = [
        notify,
        unfurl,
        agui_run,
        sweep_orphans,
        sweep_agent_runs,
        deliver_plugin_events,
    ]
    # arq's stub types cron() more narrowly than it accepts at runtime.
    cron_jobs = [
        cron(sweep_orphans, hour=4, minute=0),  # type: ignore[arg-type]
        cron(sweep_agent_runs, hour=4, minute=10),  # type: ignore[arg-type]
        # The safety net under the enqueue: retries that came due, and anything whose
        # enqueue was lost, go out within the minute.
        cron(deliver_plugin_events, second=0),  # type: ignore[arg-type]
        # Reminders are timers; a timer that fires within the minute is on time.
        cron(fire_reminders, second=30),  # type: ignore[arg-type]
        # So is a scheduled message. Offset from the reminder sweep so the two are not
        # contending for the same connections on the same second.
        cron(send_scheduled, second=15),  # type: ignore[arg-type]
        # At startup because a fresh deploy is exactly when the stored callback URL is
        # most likely stale, then on a slow cycle so a domain change heals unwatched.
        cron(
            sync_hosted_agents,
            minute={0, 10, 20, 30, 40, 50},
            run_at_startup=True,
        ),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = redis_settings()
    max_jobs = 8
