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


def _confirmation(at: datetime, repeat: str | None, zone: str, *, whom: str | None = None) -> str:
    """Read back the moment that was understood, in their clock — and, for somebody else
    or a channel, whom it is for.

    Read back rather than merely accepted: the parser is small and will sometimes hear a
    different hour than the one that was meant, and the only cheap defence against that is
    saying out loud what it heard while the person is still looking.
    """
    local = at.astimezone(zone_for(zone))
    stamp = local.strftime("%a %-d %b at %H:%M")
    rule = describe(repeat)
    what = f"Reminder {whom}" if whom else "Reminder"
    if repeat is None:
        return f"{what} set for {stamp}."
    return f"{what} set — {rule.lower()} at {local.strftime('%H:%M')}, starting {stamp}."


#: The grammar again, for reminding somebody else or a channel.
HOW_OTHERS = (
    "I didn't catch a time. Try `/remind @Ana to send the deck tomorrow at 9` or "
    "`/remind #design to post the notes every Friday at 4pm`."
)


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
        now=now,
    )

    channel = await channel_service.get_for_user(session, channel_id, user_id) if created else None
    return _confirmation(parsed.at, parsed.repeat, zone), channel


async def create_for_person(
    session: AsyncSession,
    *,
    workspace_id: str,
    author_id: str,
    person_id: str,
    person_name: str,
    args: str,
    now: datetime | None = None,
) -> tuple[str, ChannelWithState | None]:
    """`/remind @Ana to send the deck tomorrow at 9` (M3 · B3): a message from you, in the
    conversation the two of you already have, at that time — which is what a reminder
    from a colleague is. Slack sends it from its own bot; Blob has none to borrow, and a
    note in your DM is the one Ana would recognise. The time is yours: you set it."""
    if person_id == author_id:
        return await create(
            session, workspace_id=workspace_id, user_id=author_id, args=args, now=now
        )
    zone = await _timezone_of(session, author_id)
    parsed = parse_reminder(args, now=now or datetime.now(UTC), timezone=zone)
    if parsed is None:
        return HOW_OTHERS, None
    channel_id, created = await channel_service.find_or_create_dm(
        session, workspace_id, [author_id, person_id]
    )
    await scheduled_service.schedule(
        session,
        workspace_id=workspace_id,
        channel_id=channel_id,
        author_id=author_id,
        body=f"Reminder: {parsed.body}",
        send_at=as_utc(parsed.at),
        client_msg_id=new_id(),
        repeat=parsed.repeat,
        timezone=zone,
        now=now,
    )
    channel = (
        await channel_service.get_for_user(session, channel_id, author_id) if created else None
    )
    return _confirmation(parsed.at, parsed.repeat, zone, whom=f"for {person_name}"), channel


async def create_for_channel(
    session: AsyncSession,
    *,
    workspace_id: str,
    author_id: str,
    channel_id: str,
    channel_name: str,
    args: str,
    now: datetime | None = None,
) -> str:
    """`/remind #design to post the notes every Friday at 4pm` (M3 · B3): posted there as
    you, so only where you could post it now — a member, in a channel that takes your
    messages, an announcement channel's rule included."""
    from . import messages as message_service

    await channel_service.assert_channel_access(
        session, author_id, channel_id, require_member=True, require_writable=True
    )
    zone = await _timezone_of(session, author_id)
    parsed = parse_reminder(args, now=now or datetime.now(UTC), timezone=zone)
    if parsed is None:
        return HOW_OTHERS
    body = f"Reminder: {parsed.body}"
    await message_service.assert_may_post(
        session,
        author_id=author_id,
        workspace_id=workspace_id,
        channel_id=channel_id,
        body=body,
        thread_root_id=None,
    )
    await scheduled_service.schedule(
        session,
        workspace_id=workspace_id,
        channel_id=channel_id,
        author_id=author_id,
        body=body,
        send_at=as_utc(parsed.at),
        client_msg_id=new_id(),
        repeat=parsed.repeat,
        timezone=zone,
        now=now,
    )
    return _confirmation(parsed.at, parsed.repeat, zone, whom=f"in #{channel_name}")


__all__ = ["HOW", "HOW_OTHERS", "create", "create_for_channel", "create_for_person"]
