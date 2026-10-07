"""Stopping a run, from wherever Stop is pressed.

The card's Stop button and an assistant's `stop_run` (MCP) are the same act and take the
same rule: anyone who can see the conversation may stop a run in it — the person paying
attention is rarely the person who asked, which is Slack's rule too — and Stop stops the
whole piece of work, the hops this run's reply set going included (ADR 0013).

The worker hears it two ways, a key and a publish, because it subscribes before it checks
and a Stop pressed in the gap must land on one side or the other.
"""

from __future__ import annotations

from contextlib import suppress

from ..db.engine import transaction
from ..lib.errors import not_found
from ..lib.redis import redis
from . import agent_runs as agent_run_service
from . import audit as audit_service
from . import channels as channel_service


async def stop(*, workspace_id: str, run_id: str, user_id: str, actor: audit_service.Actor) -> int:
    """Stop a run that is going, and every hop it caused. Answers how many hops stopped
    with it. 404 for a run that is not running, or one in a conversation this person
    cannot see — the same answer, for the same reason."""
    async with transaction() as (session, _after):
        channel_id = await agent_run_service.running_channel(
            session, workspace_id=workspace_id, run_id=run_id
        )
        if channel_id is None:
            raise not_found("That run is not running.")
        # Access before the mark: somebody who cannot see the channel must not be able to
        # stop what is happening in it.
        await channel_service.assert_channel_access(session, user_id, channel_id)
        marked = await agent_run_service.request_cancel(
            session, workspace_id=workspace_id, run_id=run_id
        )
        if marked is None:
            raise not_found("That run is not running.")
        descendants = await agent_run_service.request_cancel_descendants(
            session, workspace_id=workspace_id, run_id=run_id
        )

    for stopped in (run_id, *descendants):
        with suppress(Exception):
            await redis.set(f"agui:cancel:{stopped}", user_id, nx=True, ex=600)
        with suppress(Exception):
            await redis.publish(f"agent:ctl:{stopped}", "cancel")

    async with transaction() as (session, _after):
        await audit_service.record(
            session,
            actor,
            "agent.run_cancelled",
            target_type="agent_run",
            target_id=run_id,
            metadata={"channelId": marked["channelId"], "cascaded": len(descendants)},
        )
    return len(descendants)


__all__ = ["stop"]
