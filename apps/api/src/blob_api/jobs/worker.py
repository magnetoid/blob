"""Background worker.

Same image as the API, different entrypoint. It consumes the queue the send path writes
to, so a slow push provider or a hung unfurl can never delay a message.

Run with:  uv run arq blob_api.jobs.worker.WorkerSettings
"""

from __future__ import annotations

import logging
from typing import Any

from arq import cron, func
from sqlalchemy import text

from ..config import settings
from ..db.engine import close_engine, session_scope, transaction
from ..lib import readiness, telemetry
from ..lib.queue import close_queue, redis_settings
from ..lib.redis import close_redis
from ..lib.storage import delete_object
from ..plugins import delivery as plugin_delivery
from ..realtime import hub
from ..services import agent_notes as agent_notes_service
from ..services import agent_runs as agent_run_service
from ..services import agent_state as agent_state_service
from ..services import oauth as oauth_service
from ..services import usage as usage_service
from ..services.calls import reconcile as reconcile_calls
from .agui import expire_agent_decisions as expire_decisions
from .agui import handle_agent_heard, handle_agui_run, resume_waiting_runs
from .deployments import sync_hosted_agents
from .notify import handle_notify
from .reminders import fire_reminders
from .retention import sweep_retention
from .scheduled import send_scheduled
from .unanswered import nudge_unanswered
from .unfurl import handle_unfurl

log = logging.getLogger("blob.worker")

#: Unattached uploads are swept after this long.
ORPHAN_AGE_HOURS = 24

#: What an agent run may take past its own wall (`AGUI_MAX_RUN_SEC`): reading the
#: history before the call, and storing files and posting answers after it. The run's
#: own clocks end the stream; this only has to outlast them, so arq's ceiling is a
#: backstop that a healthy run never meets.
RUN_JOB_SLACK_SEC = 120.0


def agui_run_timeout_sec() -> float:
    """arq's ceiling on one agent run, which must sit above the run's own wall.

    It sat below it — the worker-wide `job_timeout` of 300 against a 600-second
    `AGUI_MAX_RUN_SEC` — so every run past five minutes was cancelled by arq with its
    answer unposted and its row still `running` until the nightly sweep. The run's
    clocks are the policy; this number only has to be out of their way.
    """
    return settings.AGUI_MAX_RUN_SEC + RUN_JOB_SLACK_SEC


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


async def agent_heard(_ctx: dict[str, Any], run_id: str) -> None:
    """Carry on a run that asked another agent something, now that it has stopped
    (M2 · A2). Enqueued by that agent's finish; one try, like a run."""
    await handle_agent_heard(run_id)


async def resume_waiting(_ctx: dict[str, Any]) -> None:
    """The net under that enqueue: waits whose answer came first, never came, or ran out."""
    resumed = await resume_waiting_runs()
    if resumed:
        log.info("carried on %d run(s) that were waiting on another agent", resumed)


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
        # And what agents remember, once nobody has touched it for a season: one row per
        # agent per conversation grew for ever, and a plan from months ago handed to the
        # next run is not memory but confusion (migration 0050).
        forgotten = await agent_state_service.sweep(session)
        # And the notes agents kept, a conversation's at a time, on the same terms (M2 · A8).
        unnoted = await agent_notes_service.sweep(session)
        # And Blob's own model calls, kept as long as the runs beside them (M2 · A9).
        await usage_service.sweep(session)
    if removed:
        log.info("swept %d agent run(s)", removed)
    if forgotten:
        log.info("forgot %d stale agent memor(ies)", forgotten)
    if unnoted:
        log.info("forgot %d stale agent note(s)", unnoted)


async def sweep_expired(_ctx: dict[str, Any]) -> None:
    counts = await sweep_retention()
    if sum(counts.values()):
        log.info("retention sweep %s", counts)
    # An assistant that signed in is minted an hour-long token every hour and a refresh
    # link with each (ADR 0029); spent ones are nobody's to keep.
    async with transaction() as (session, _):
        spent = await oauth_service.sweep(session)
    if spent:
        log.info("swept %d spent assistant credential(s)", spent)


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


async def sweep_calls(_ctx: dict[str, Any]) -> None:
    """Calls agree with LiveKit: rooms that closed end their call, and who is in a call is
    what LiveKit says. The webhooks do this as it happens; this catches what they missed."""
    changed = await reconcile_calls()
    if changed:
        log.info("call sweep changed %d call(s)", changed)


async def heartbeat(_ctx: dict[str, Any]) -> None:
    """Tell `/readyz` the worker is alive. Its own job rather than a side effect of
    another, so a quiet workspace with nothing to deliver still reads as up."""
    await readiness.beat()


async def startup(_ctx: dict[str, Any]) -> None:
    # Runs are the worker's, so their traces start here — when there is an endpoint.
    telemetry.configure("worker")
    # The worker broadcasts too (read-state updates from notify), so it needs the bridge.
    await hub.start_redis_bridge()
    log.info("worker ready")


async def shutdown(_ctx: dict[str, Any]) -> None:
    await hub.stop_redis_bridge()
    await plugin_delivery.close_client()
    await close_queue()
    await close_redis()
    await close_engine()
    telemetry.shutdown()


async def after_job_end(ctx: dict[str, Any]) -> None:
    """A line in *our* log after arq has written the result.

    arq already logs the traceback at the moment of failure. That line is easy to miss
    in a retry storm: try 1 fails, try 2 fails, try 3 gives up, and the only record is
    three identical exceptions. This fires once the result is stored, so a job that
    died for good is greppable as `job … failed` without reconstructing the earlier
    frames. Success is silent — arq already logs those.
    """
    job_id = ctx.get("job_id")
    redis = ctx.get("redis")
    if not job_id or redis is None:
        return
    from arq.jobs import Job

    info = await Job(str(job_id), redis).result_info()
    if info is None or info.success:
        return
    log.error(
        "job %s failed (try %s): %r",
        info.function,
        ctx.get("job_try"),
        info.result,
    )


class WorkerSettings:
    functions = [
        notify,
        unfurl,
        # Its own ceiling, above the run's wall, and one try. arq retries a job it
        # cancelled — a deploy stopping the worker mid-run is the usual case — and a
        # retry would ask the agent again: new tokens, a different answer, posted beside
        # whatever the first try managed to say. The run marks itself failed on the way
        # out instead (`agui_outcome.run_one`), and the person can ask again.
        func(agui_run, timeout=agui_run_timeout_sec(), max_tries=1),  # type: ignore[arg-type]
        # A resume is a run too, with the same ceiling and the same single try.
        func(agent_heard, timeout=agui_run_timeout_sec(), max_tries=1),  # type: ignore[arg-type]
        sweep_orphans,
        sweep_expired,
        sweep_agent_runs,
        expire_agent_decisions,
        deliver_plugin_events,
    ]
    # arq's stub types cron() more narrowly than it accepts at runtime.
    cron_jobs = [
        cron(sweep_orphans, hour=4, minute=0),  # type: ignore[arg-type]
        cron(sweep_expired, hour=4, minute=20),  # type: ignore[arg-type]
        cron(sweep_agent_runs, hour=4, minute=10),  # type: ignore[arg-type]
        # A decision waits a day; a quarter of an hour's slack on that is fine, a day's
        # (from riding the nightly sweep) is not.
        cron(expire_agent_decisions, minute={0, 15, 30, 45}),  # type: ignore[arg-type]
        # A question a day old is not a minute-sensitive thing; a quarter of an hour's slack
        # is fine. Offset from the decision sweep so the two never share a tick.
        cron(nudge_unanswered, minute={5, 20, 35, 50}),  # type: ignore[arg-type]
        # The safety net under the enqueue: retries that came due, and anything whose
        # enqueue was lost, go out within the minute.
        cron(deliver_plugin_events, second=0),  # type: ignore[arg-type]
        # Reminders are timers; a timer that fires within the minute is on time.
        cron(fire_reminders, second=30),  # type: ignore[arg-type]
        # So is a scheduled message. Offset from the reminder sweep so the two are not
        # contending for the same connections on the same second.
        cron(send_scheduled, second=15),  # type: ignore[arg-type]
        # :45, so it does not share a second with the outbox (:00), reminders (:30) or
        # scheduled sends (:15).
        cron(sweep_calls, second=45),  # type: ignore[arg-type]
        # :50, the last free slot in the minute; at startup too, so a fresh deploy reads
        # as up on the first readiness check rather than a minute later.
        cron(heartbeat, second=50, run_at_startup=True),  # type: ignore[arg-type]
        # :05 — a run waiting on another agent hears within the minute when the hop's own
        # enqueue was missed; the free second nearest the outbox's.
        cron(resume_waiting, second=5),  # type: ignore[arg-type]
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
    # Explicit, not "whatever arq ships". A hung unfurl used to sit on a worker slot
    # until the process was killed: webpush now times out at 10s, but the job itself
    # still needs a ceiling. Five minutes is short enough that a wedged job is visible.
    # An agent run is the exception and carries its own, above (`agui_run_timeout_sec`).
    job_timeout = 300
    # Three, not arq's five. A notify that failed because Redis blinked should retry;
    # a notify that failed because the payload is poison should not occupy the queue
    # for the rest of the morning.
    max_tries = 3
    after_job_end = after_job_end
