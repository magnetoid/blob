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

from ..db.engine import close_engine, session_scope, transaction
from ..lib.queue import close_queue, redis_settings
from ..lib.redis import close_redis
from ..lib.storage import delete_object
from ..plugins import delivery as plugin_delivery
from ..realtime import hub
from ..services import agent_runs as agent_run_service
from .agui import expire_agent_decisions as expire_decisions
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


async def agui_run(_ctx: dict[str, Any], message_id: str, parent_run_id: str | None = None) -> None:
    """Answer a mention of an AG-UI app's bot.

    No cron behind this one, unlike the plugin outbox: there is no durable table of owed
    runs, and re-running an agent an hour late is worse than not running it at all.

    `parent_run_id` is set when the mention came from an agent's own reply, or when the
    message answers a decision an agent was waiting on — the two ways a run can be part
    of a chain rather than the start of one. See ADR 0013.
    """
    await handle_agui_run(message_id, parent_run_id)


async def expire_agent_decisions(_ctx: dict[str, Any]) -> None:
    """Decisions nobody made within their day become `expired`, and their buttons go."""
    expired = await expire_decisions()
    if expired:
        log.info("expired %d agent decision(s)", expired)


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
    """Uploads that were started but never attached to a message.

    The object goes first and the row goes second, and the order is the whole point.
    This used to `DELETE ... RETURNING object_key`, commit, and then delete the objects
    outside the transaction, swallowing failures. The row is the only record that the
    object exists, so a storage outage during the nightly sweep deleted every row,
    failed every delete, and left the files behind with nothing left to find them by —
    a leak that no later sweep could ever clean up, because the evidence was gone.

    Now a failed delete simply leaves the row, and the next sweep tries again.
    """
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, object_key FROM attachments
                     WHERE message_id IS NULL
                       AND created_at < now() - make_interval(hours => :hours)
                    """
                ),
                {"hours": ORPHAN_AGE_HOURS},
            )
        ).fetchall()

    swept: list[str] = []
    for row in rows:
        try:
            await delete_object(row.object_key)
        except Exception:
            # Kept, deliberately. The row is what lets the next sweep find this file.
            log.warning("could not delete %s; keeping its row", row.object_key, exc_info=True)
            continue
        swept.append(str(row.id))

    if swept:
        async with transaction() as (session, _):
            await session.execute(
                text("DELETE FROM attachments WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": swept},
            )
        log.info("swept %d orphaned upload(s)", len(swept))


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
        expire_agent_decisions,
        deliver_plugin_events,
    ]
    # arq's stub types cron() more narrowly than it accepts at runtime.
    cron_jobs = [
        cron(sweep_orphans, hour=4, minute=0),  # type: ignore[arg-type]
        cron(sweep_agent_runs, hour=4, minute=10),  # type: ignore[arg-type]
        # A decision waits a day; a quarter of an hour's slack on that is fine, a day's
        # (from riding the nightly sweep) is not.
        cron(expire_agent_decisions, minute={0, 15, 30, 45}),  # type: ignore[arg-type]
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
