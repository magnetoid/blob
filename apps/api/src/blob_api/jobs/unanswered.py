"""Nudge the people whose questions nobody answered.

Every quarter hour. The sweep reads its candidates under a plain session, then handles
each in its own transaction: claim the question (the `unanswered_nudges` row is the
once-only ratchet, so two workers cannot both take it), arm the reminder, commit. One
failure is logged and the rest go on; a question the sweep keeps failing on falls out
of the window on its own.

`now` is a seam for tests, keyword-only with a default because arq hands a cron exactly
one positional argument. Nothing here talks to a model or to the network.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from ..db.engine import session_scope, transaction
from ..services import unanswered as unanswered_service

log = logging.getLogger("blob.worker")


async def nudge_unanswered(_ctx: dict[str, Any], *, now: datetime | None = None) -> int:
    moment = now or datetime.now(UTC)
    async with session_scope() as session:
        questions = await unanswered_service.candidates(session, now=moment)
    if not questions:
        return 0

    nudged = 0
    for question in questions:
        if not unanswered_service.wants(question):
            continue
        try:
            async with transaction() as (session, _after):
                if not await unanswered_service.claim(session, question):
                    continue
                await unanswered_service.nudge(session, question)
            nudged += 1
        except Exception:
            log.warning("nudge for question %s failed", question.id, exc_info=True)
    if nudged:
        log.info("nudged %d unanswered question(s)", nudged)
    return nudged


__all__ = ["nudge_unanswered"]
