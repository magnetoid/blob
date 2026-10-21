"""Sending the away emails (M3 · B3, ADR 0036): once a minute, everybody whose window has
passed gets one email about what is still waiting for them.

A person who has come back gets nothing — Blob shows them what is unread itself — and
their queue is dropped. Quiet hours keep it: the email goes when they end, if anything is
still unread by then. A mail server that refuses one email is not asked again for a
quarter of an hour, so a server with no working SMTP logs one line per quarter hour
instead of one per person per minute; what waited stays queued for after, until a day
has passed.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from ..db.engine import session_scope, transaction
from ..lib import mail
from ..lib.redis import redis
from ..realtime import presence
from ..services import away_mail
from ..services.notify import Recipient, is_snoozed
from ..services.serialize import read_prefs

log = logging.getLogger("blob.jobs.away_mail")

#: Where a refused send parks the whole job, and for how long.
PAUSE_KEY = "mail:away:paused"
PAUSE_SEC = 15 * 60


async def send_away_mail(now: datetime | None = None) -> int:
    """One tick. Returns how many emails went."""
    now = now or datetime.now(UTC)
    if await redis.get(PAUSE_KEY):
        return 0
    async with transaction() as (session, _after):
        await away_mail.expire(session, now)
        people = await away_mail.due(session, now)
    if not people:
        return 0

    try:
        states = await presence.get_presence([person.user_id for person in people])
    except Exception:
        # Who is at their desk cannot be told, so nobody is mailed this minute: an email
        # to somebody reading Blob is the mistake to avoid, and the queue keeps.
        log.warning("presence unavailable; away mail waits a minute")
        return 0

    sent = 0
    for person in people:
        if states.get(person.user_id) == "active":
            # Back before the window ran out: the app shows them what is unread.
            async with transaction() as (session, _after):
                await away_mail.clear(session, person.user_id, up_to=now)
            continue
        recipient = Recipient(
            user_id=person.user_id, prefs=read_prefs(person.prefs), timezone=person.timezone
        )
        if is_snoozed(recipient, now):
            continue
        async with session_scope() as session:
            items = await away_mail.waiting(session, person.user_id)
        if items:
            email = away_mail.compose(person, items)
            went = await mail.send_mail(
                person.email, email.subject, email.body, headers=email.headers
            )
            if not went:
                await redis.set(PAUSE_KEY, "1", ex=PAUSE_SEC)
                log.warning("away mail paused for %d minutes: the mail server refused", 15)
                break
            sent += 1
        async with transaction() as (session, _after):
            await away_mail.clear(session, person.user_id, up_to=now)
    return sent


__all__ = ["PAUSE_KEY", "PAUSE_SEC", "send_away_mail"]
