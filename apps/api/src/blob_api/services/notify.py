"""Who gets notified, and how.

Notification fatigue is the single most common complaint about every incumbent chat app,
so the rules here are deliberately conservative: silence is the default and each delivery
has to be justified by an explicit signal.

`decide` is a pure function of message plus recipients, so the policy is exhaustively
testable without a database.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.mentions import matches_keywords
from ..schemas.models import UserPrefs
from .serialize import read_prefs

NotifyLevel = Literal["all", "mentions", "none"]
NotifyReason = Literal["dm", "mention", "group", "everyone", "keyword", "all_activity", "thread"]


@dataclass(slots=True)
class Recipient:
    user_id: str
    notify_level: NotifyLevel = "mentions"
    prefs: UserPrefs = field(default_factory=UserPrefs)
    timezone: str = "UTC"


@dataclass(slots=True)
class NotifiableMessage:
    id: str
    channel_id: str
    channel_kind: str
    author_id: str | None
    body: str
    mention_user_ids: list[str] = field(default_factory=list)
    #: Groups this message named. Kept as groups: resolving them to people happens here,
    #: at notify time, against *current* membership — not frozen into the message row.
    mention_group_ids: list[str] = field(default_factory=list)
    mentions_everyone: bool = False
    thread_root_id: str | None = None


@dataclass(slots=True)
class Decision:
    user_id: str
    reason: NotifyReason
    #: True when the mention badge should increment (mentions and DMs only).
    counts_as_mention: bool


def decide(
    message: NotifiableMessage,
    recipients: list[Recipient],
    now: datetime | None = None,
    thread_subscribers: set[str] | None = None,
    group_recipients: set[str] | None = None,
) -> list[Decision]:
    now = now or datetime.now(UTC)
    thread_subscribers = thread_subscribers or set()
    # Members of the groups this message named, already filtered to those who have not
    # muted the group. Resolved by the caller, because that is a query and this stays a
    # pure function — the same arrangement `thread_subscribers` uses.
    group_recipients = group_recipients or set()
    decisions: list[Decision] = []

    for recipient in recipients:
        if recipient.user_id == message.author_id:
            continue
        if recipient.notify_level == "none":
            continue
        if is_snoozed(recipient, now):
            continue

        is_dm = message.channel_kind in ("dm", "group_dm")
        mentioned = recipient.user_id in message.mention_user_ids

        if is_dm:
            decisions.append(Decision(recipient.user_id, "dm", True))
        elif mentioned:
            decisions.append(Decision(recipient.user_id, "mention", True))
        elif recipient.user_id in group_recipients:
            # Badge-strength, because being named as part of a team you are on is being
            # named — but labelled apart from "mention" so the two can ever be told
            # apart downstream. Below a direct mention: somebody named personally *and*
            # via a group has been named personally.
            decisions.append(Decision(recipient.user_id, "group", True))
        elif message.mentions_everyone:
            # Muted channels already returned above, so reaching here means they opted in.
            decisions.append(Decision(recipient.user_id, "everyone", True))
        elif matches_keywords(message.body, recipient.prefs.keywords):
            decisions.append(Decision(recipient.user_id, "keyword", True))
        elif message.thread_root_id and recipient.user_id in thread_subscribers:
            decisions.append(Decision(recipient.user_id, "thread", False))
        elif recipient.notify_level == "all":
            decisions.append(Decision(recipient.user_id, "all_activity", False))

    return decisions


def is_snoozed(recipient: Recipient, now: datetime) -> bool:
    """Manual snooze, or outside the user's configured working hours."""
    snooze_until = recipient.prefs.snooze_until
    if snooze_until:
        try:
            if datetime.fromisoformat(snooze_until.replace("Z", "+00:00")) > now:
                return True
        except ValueError:
            pass

    # A shape, not a dict. It used to be `dict[str, Any]` read with `.get()` and coerced
    # with `int()`, so a stored `{"startHour": "nine"}` raised inside this function — and
    # this runs for every recipient of every message, so one person's saved preferences
    # took down notifications for everyone in the channel. `QuietHours` bounds the hours
    # and the days where they are written, which is where the value stops being able to
    # be anything.
    dnd = recipient.prefs.dnd
    if not dnd or not dnd.enabled:
        return False

    local = _local_parts(now, recipient.timezone)
    if dnd.days and local["weekday"] not in dnd.days:
        return True

    start = dnd.start_hour
    end = dnd.end_hour
    if start == end:
        return False

    # Quiet hours are *outside* [start, end); a window that wraps midnight is handled
    # by the same comparison.
    hour = local["hour"]
    within_working_hours = start <= hour < end if start < end else (hour >= start or hour < end)
    return not within_working_hours


def _local_parts(moment: datetime, timezone: str) -> dict[str, int]:
    try:
        local = moment.astimezone(ZoneInfo(timezone))
    except (ZoneInfoNotFoundError, ValueError):
        local = moment.astimezone(UTC)
    # Python's Monday=0; the client sends Sunday=0, matching JavaScript's getDay().
    return {"hour": local.hour, "weekday": (local.weekday() + 1) % 7}


async def load_recipients(session: AsyncSession, channel_id: str) -> list[Recipient]:
    """Load the notification-relevant state for every member of a channel.

    The LIMIT is a ceiling far above this product's scale, not a policy: an
    unbounded fan-out with a JSONB column per row is how one enormous channel
    stalls the worker for everyone.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT cm.user_id, cm.notify_level, u.prefs, u.timezone
                  FROM channel_members cm
                  JOIN users u ON u.id = cm.user_id
                 WHERE cm.channel_id = :channel_id AND u.deactivated_at IS NULL
                 LIMIT 5000
                """
            ),
            {"channel_id": channel_id},
        )
    ).fetchall()

    return [
        Recipient(
            user_id=row.user_id,
            notify_level=row.notify_level,
            prefs=read_prefs(row.prefs),
            timezone=row.timezone,
        )
        for row in rows
    ]


async def load_group_recipients(session: AsyncSession, group_ids: list[str]) -> set[str]:
    """Everyone in these groups who has not muted them.

    Resolved here rather than frozen into the message when it was sent, which is the
    decision the whole design turns on. Membership at *send* time is what a flattened
    array would have preserved, and it is the wrong answer: editing a typo re-resolves
    mentions, so an edit would silently rewrite who had been pinged.

    A muted group is silent, and that is a different switch from muting the channel —
    `decide` short-circuits on `notify_level == "none"` before any of this runs, so the
    two compose rather than one standing in for the other.
    """
    if not group_ids:
        return set()
    rows = (
        await session.execute(
            text(
                """
                SELECT DISTINCT user_id FROM user_group_members
                 WHERE group_id = ANY(cast(:ids AS uuid[])) AND muted = false
                """
            ),
            {"ids": group_ids},
        )
    ).fetchall()
    return {str(row.user_id) for row in rows}


async def load_thread_subscribers(session: AsyncSession, thread_root_id: str) -> set[str]:
    rows = (
        await session.execute(
            text(
                """
                SELECT user_id FROM thread_subscriptions
                 WHERE thread_root_id = :root_id AND muted = false
                """
            ),
            {"root_id": thread_root_id},
        )
    ).fetchall()
    return {row.user_id for row in rows}
