"""When a repeating schedule comes round again.

Kept apart from the sending because the arithmetic is the part that can be wrong, and
because it is only testable on its own: `next_occurrence` takes the moment rather than
reading the clock, so a test can stand on the Sunday the clocks change without waiting
for October.

**The whole reason this is not `send_at + timedelta(days=1)`.** "Every weekday at nine"
is a statement about a wall clock. Add twenty-four hours in UTC and, on the two days a
year a zone shifts, the reminder moves to eight or ten and stays there — a drift nobody
reports as a bug because each individual message looks fine. So the next occurrence is
built in the author's own zone, from the *local* time of day, and converted back.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

#: What a schedule may repeat as. The database holds the same list in a CHECK.
REPEATS = ("daily", "weekdays", "weekly")

#: Monday is 0 in Python; a weekday is Monday through Friday.
_WEEKEND = (5, 6)


def _zone(name: str) -> ZoneInfo:
    """The author's zone, or UTC. A zone that has gone away must not stop the sweep."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def next_occurrence(previous: datetime, repeat: str, timezone: str) -> datetime | None:
    """The moment after `previous` that `repeat` next names, or None if it names none.

    `previous` is the occurrence that has just gone out. The result is always strictly
    after it, which is what stops a sweep that runs late from firing the same slot twice.
    """
    if repeat not in REPEATS:
        return None

    zone = _zone(timezone)
    local = previous.astimezone(zone)

    if repeat == "weekly":
        step = timedelta(days=7)
    else:
        step = timedelta(days=1)

    candidate = local + step
    if repeat == "weekdays":
        # Saturday and Sunday are not slots; the next one is Monday.
        while candidate.weekday() in _WEEKEND:
            candidate += timedelta(days=1)

    # Rebuilt from the local wall clock rather than carried as an instant. Adding a day
    # to an aware datetime keeps the *offset* it had, so the day after a clocks-forward
    # Sunday would land an hour early and every occurrence after it would inherit that.
    rebuilt = datetime(
        candidate.year,
        candidate.month,
        candidate.day,
        local.hour,
        local.minute,
        local.second,
        tzinfo=zone,
    )
    return rebuilt.astimezone(previous.tzinfo)


def describe(repeat: str | None) -> str:
    """How a schedule reads in a list. Plain words, because it sits beside a message."""
    return {
        "daily": "Every day",
        "weekdays": "Every weekday",
        "weekly": "Every week",
    }.get(repeat or "", "Once")


__all__ = ["REPEATS", "describe", "next_occurrence"]
