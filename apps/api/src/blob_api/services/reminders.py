"""`/remind me to X at Y`.

A reminder is a scheduled message to yourself, which is not a workaround — it is what a
reminder *is*, and saying so costs no new table, no new job and no new delivery path. The
sweep that sends scheduled messages sends this one, the recurrence engine repeats it, the
Scheduled view lists it, and cancelling it is the button that is already there.

Where it lands is the conversation you have with yourself. Blob already supports one — a
DM whose only member is you, which `find_or_create_dm` returns for a one-member set and the
client already titles "You". Slack delivers reminders as a message from Slackbot; Blob's
built-in agent is not guaranteed to exist (it is seeded only when a model provider is
configured, deliberately), so a reminder that depended on it would be a feature that works
on some workspaces and not others.

The parsing lives in `when.py`, apart, because it is the part that can be wrong.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.ids import new_id
from ..schemas.models import ChannelWithState
from . import channels as channel_service
from . import scheduled as scheduled_service
from .recurrence import describe
from .when import as_utc, parse_reminder, zone_for

#: What the command says when it could not read a time. The whole grammar, because the
#: alternative is somebody guessing at it one phrase at a time.
HOW = (
    "I didn't catch a time. Try `/remind me to water the plants tomorrow at 9`, "
    "`/remind me in 20 minutes to check the oven`, or "
    "`/remind me to post standup every weekday at 9am`."
)


async def _timezone_of(session: AsyncSession, user_id: str) -> str:
    """The author's own zone, which is the one "nine o'clock" is a statement about."""
    zone = (
        await session.execute(text("SELECT timezone FROM users WHERE id = :id"), {"id": user_id})
    ).scalar_one_or_none()
    return str(zone) if zone else "UTC"


def _confirmation(at: datetime, repeat: str | None, zone: str) -> str:
    """Read back the moment that was understood, in their clock.

    Read back rather than merely accepted: the parser is small and will sometimes hear a
    different hour than the one that was meant, and the only cheap defence against that is
    saying out loud what it heard while the person is still looking.
    """
    local = at.astimezone(zone_for(zone))
    stamp = local.strftime("%a %-d %b at %H:%M")
    rule = describe(repeat)
    if repeat is None:
        return f"Reminder set for {stamp}."
    return f"Reminder set — {rule.lower()} at {local.strftime('%H:%M')}, starting {stamp}."


async def create(
    session: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    args: str,
    now: datetime | None = None,
) -> tuple[str, ChannelWithState | None]:
    """Set one. Answers (what to tell them, the DM if it had to be created).

    The channel comes back only when it is new, because that is the only time the client
    has to be told about a conversation it has never seen. Nothing navigates: `/remind` is
    something you say in passing, and taking somebody out of the channel they were reading
    to show them a note they will get later is the opposite of what they asked for.
    """
    zone = await _timezone_of(session, user_id)
    parsed = parse_reminder(args, now=now or datetime.now(UTC), timezone=zone)
    if parsed is None:
        return HOW, None

    channel_id, created = await channel_service.find_or_create_dm(session, workspace_id, [user_id])
    await scheduled_service.schedule(
        session,
        workspace_id=workspace_id,
        channel_id=channel_id,
        author_id=user_id,
        body=parsed.body,
        send_at=as_utc(parsed.at),
        # Fresh, not derived from the text: two identical reminders set a minute apart are
        # two reminders, and the send path deduplicates on this.
        client_msg_id=new_id(),
        repeat=parsed.repeat,
        timezone=zone,
    )

    channel = await channel_service.get_for_user(session, channel_id, user_id) if created else None
    return _confirmation(parsed.at, parsed.repeat, zone), channel


__all__ = ["HOW", "create"]
