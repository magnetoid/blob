"""Sending the messages that came due.

Every minute, because a message scheduled for nine should go out at nine and not at ten
past. The sweep claims its batch with `SKIP LOCKED`, so a second worker takes different
rows rather than the same ones — and each row is sent in its own transaction, so one
message failing does not roll back the ones already sent beside it.
"""

from __future__ import annotations

import logging
from typing import Any

from ..db.engine import session_scope, transaction
from ..lib.errors import AppError
from ..services import messages as message_service
from ..services import scheduled as scheduled_service

log = logging.getLogger("blob.worker")


async def send_scheduled(_ctx: dict[str, Any]) -> None:
    async with session_scope() as session:
        due = await scheduled_service.due_batch(session)
    if not due:
        return

    sent = 0
    for item in due:
        try:
            # One transaction per message. `after` drains past COMMIT, which is what
            # makes the socket see a message that is actually stored — the same ordering
            # the live send path relies on.
            async with transaction() as (session, after):
                result = await scheduled_service.deliver(session, item)
                await scheduled_service.mark_sent(session, str(item["id"]), result.message.id)
                # The half that was missing. Storing the row is not sending the message:
                # without this there is no socket frame, no notification, no unfurl, no
                # agent run and no outbox row — a scheduled message arrived only for
                # people who happened to reload.
                await message_service.announce(
                    session,
                    after,
                    result,
                    workspace_id=str(item["workspace_id"]),
                    channel_id=str(item["channel_id"]),
                )
            sent += 1
        except AppError as refusal:
            # An expected no: the channel is gone, or the author is no longer in it.
            async with transaction() as (session, _after):
                await scheduled_service.mark_failed(session, str(item["id"]), refusal.message)
            log.info("scheduled message %s not sent: %s", item["id"], refusal.message)
        except Exception:
            # Unexpected, so it keeps its place in the queue and the next sweep tries
            # again — a database blip should not throw a message away.
            log.warning("scheduled message %s failed", item["id"], exc_info=True)

    if sent:
        log.info("sent %d scheduled message(s)", sent)
