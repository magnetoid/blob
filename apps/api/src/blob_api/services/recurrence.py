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
    #
    # And a slot the clock skipped is skipped too. On the morning a zone springs forward
    # there is no 02:30, and Python resolves a time that does not exist to one an hour
    # later — which is not merely late, it is *inherited*: the next occurrence reads its
    # hour back from that instant and every one after it is an hour out for ever. Which
    # is the exact drift this module exists to prevent. Missing one occurrence a year is
    # the smaller wrong, and it is the true one: that minute did not happen.
    for _ in range(len(_WEEKEND) + MAX_SKIPPED_SLOTS):
        rebuilt = datetime(
            candidate.year,
            candidate.month,
            candidate.day,
            local.hour,
            local.minute,
            local.second,
            tzinfo=zone,
        )
        if _wall_clock_exists(rebuilt, zone):
            return rebuilt.astimezone(previous.tzinfo)
        candidate += step
        if repeat == "weekdays":
            while candidate.weekday() in _WEEKEND:
                candidate += timedelta(days=1)
    return None


#: How many consecutive slots may fall in a clock-change gap before giving up. One is
#: the real answer; the rest is headroom for a zone that does something stranger.
MAX_SKIPPED_SLOTS = 4


def _wall_clock_exists(moment: datetime, _zone: ZoneInfo) -> bool:
    """Did this reading on this clock actually happen in this zone?

    Asked through PEP 495's fold rather than by converting and comparing — `astimezone`
    into the zone a datetime is already in is a no-op, so a round trip shows nothing.

    The two folds disagree only at a transition, and *which way* they disagree says which
    kind it is: a clock that jumps forward leaves a gap and the offset increases, so
    `fold=0` (before) is less than `fold=1` (after). A clock that goes back repeats an
    hour and the offset decreases. Only the first names a time that never existed.
    """
    before = moment.replace(fold=0).utcoffset()
    after = moment.replace(fold=1).utcoffset()
    if before is None or after is None:
        return True
    return not before < after


def describe(repeat: str | None) -> str:
    """How a schedule reads in a list. Plain words, because it sits beside a message."""
    return {
        "daily": "Every day",
        "weekdays": "Every weekday",
        "weekly": "Every week",
    }.get(repeat or "", "Once")


__all__ = ["REPEATS", "describe", "next_occurrence"]
