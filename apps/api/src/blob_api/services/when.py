"""Reading a time out of a sentence.

`/remind me to water the plants tomorrow at 9` has to become a moment, and the moment has
to be the one the person meant — which is a wall-clock moment in their own zone, not an
instant in UTC that happens to coincide today.

Kept apart from the command that uses it for the same reason `recurrence` is: this is the
part that can be wrong, and it is only testable on its own. Everything here takes `now`
rather than reading the clock, so a test can stand on any Tuesday it likes.

**The grammar is small on purpose.** A parser that accepts "a week on Thursday afternoon"
is a parser that silently mis-hears half of what it accepts, and a reminder that arrives at
the wrong time is worse than one that was refused — the refusal is visible and the person
retypes it in five seconds. So this reads a short list of shapes and answers `None` for
everything else, and the command says what it does understand.

What it reads, at the start of the sentence or at the end of it, because Slack takes both:

    in 20 minutes / in 2 hours / in 3 days / in 1 week
    at 9 / at 9am / at 21:30 / at 9:30 pm
    today at 9am / tomorrow at 9am / tomorrow
    monday / on friday at 17:00
    every day at 9am / every weekday at 9am / every week at 9am
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

#: When a day is named without an hour. Nine in the morning, which is what "tomorrow"
#: means to somebody typing it into a work chat.
DEFAULT_HOUR = 9

_UNITS = {
    "min": 60,
    "mins": 60,
    "minute": 60,
    "minutes": 60,
    "hr": 3600,
    "hrs": 3600,
    "hour": 3600,
    "hours": 3600,
    "day": 86400,
    "days": 86400,
    "week": 604800,
    "weeks": 604800,
}

_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}

#: "at 9", "at 9am", "at 9:30 pm", "at 21:30". The meridiem is optional and so are the
#: minutes; 24-hour and 12-hour both appear in the same workspace and neither is wrong.
_CLOCK = r"at\s+(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<meridiem>am|pm)?"

_PATTERNS: list[tuple[str, str]] = [
    ("in", r"in\s+(?P<count>\d{1,4})\s*(?P<unit>[a-z]+)"),
    ("every", rf"every\s+(?P<every>day|weekday|week)\s+{_CLOCK}"),
    ("named-day", rf"(?:on\s+)?(?P<day>today|tomorrow|{'|'.join(_WEEKDAYS)})\s+{_CLOCK}"),
    ("clock", _CLOCK),
    ("bare-day", rf"(?:on\s+)?(?P<bare>today|tomorrow|{'|'.join(_WEEKDAYS)})"),
]


@dataclass(frozen=True, slots=True)
class When:
    """A moment, and whether it comes back."""

    at: datetime
    repeat: str | None = None


@dataclass(frozen=True, slots=True)
class Reminder:
    """What to say, and when to say it."""

    body: str
    at: datetime
    repeat: str | None = None


def zone_for(name: str) -> ZoneInfo:
    """The author's zone, or UTC. A zone that has gone away must not raise mid-command."""
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _clock_hour(match: re.Match[str]) -> tuple[int, int] | None:
    """The hour and minute a clock phrase names, or None if it names none at all.

    None covers two different absences and the caller tells them apart by which pattern
    matched: a phrase with no clock in it (`tomorrow`), and a clock that is not a time
    (`at 25:00`). Both mean "do not read an hour from this".
    """
    if not match.groupdict().get("hour"):
        return None
    hour = int(match.group("hour"))
    minute = int(match.group("minute") or 0)
    meridiem = (match.group("meridiem") or "").lower()

    if minute > 59:
        return None
    if meridiem:
        # 12am is midnight and 12pm is noon, which is the one case the arithmetic below
        # gets wrong if it is not said out loud.
        if not 1 <= hour <= 12:
            return None
        if meridiem == "am":
            hour = 0 if hour == 12 else hour
        else:
            hour = 12 if hour == 12 else hour + 12
    elif hour > 23:
        return None
    return hour, minute


def _at_local(base: datetime, hour: int, minute: int) -> datetime:
    """That time on that day, rebuilt from the wall clock rather than added to it."""
    return datetime(base.year, base.month, base.day, hour, minute, tzinfo=base.tzinfo)


def _resolve(match: re.Match[str], kind: str, now_local: datetime) -> When | None:
    if kind == "in":
        seconds = _UNITS.get(match.group("unit").lower())
        if seconds is None:
            return None
        count = int(match.group("count"))
        if count == 0:
            return None
        # A duration really is arithmetic on an instant: "in two hours" means two hours
        # from now even if the clocks change in between. Unlike a wall-clock time, which
        # is what everything below rebuilds.
        return When(at=now_local + timedelta(seconds=count * seconds))

    clock = _clock_hour(match)

    if kind == "every":
        if clock is None:
            return None
        hour, minute = clock
        rule = {"day": "daily", "weekday": "weekdays", "week": "weekly"}[
            match.group("every").lower()
        ]
        candidate = _at_local(now_local, hour, minute)
        if candidate <= now_local:
            candidate = _at_local(now_local + timedelta(days=1), hour, minute)
        # The first occurrence is a slot the rule names; `recurrence` walks on from it.
        if rule == "weekdays":
            while candidate.weekday() in (5, 6):
                candidate = _at_local(candidate + timedelta(days=1), hour, minute)
        return When(at=candidate, repeat=rule)

    if kind in ("named-day", "bare-day"):
        name = (match.groupdict().get("day") or match.groupdict().get("bare") or "").lower()
        hour, minute = clock if clock else (DEFAULT_HOUR, 0)
        if kind == "named-day" and clock is None:
            return None

        if name == "today":
            candidate = _at_local(now_local, hour, minute)
        elif name == "tomorrow":
            candidate = _at_local(now_local + timedelta(days=1), hour, minute)
        else:
            # The next one strictly ahead: "monday" typed on a Monday means next Monday,
            # unless the hour is still to come today.
            target = _WEEKDAYS[name]
            ahead = (target - now_local.weekday()) % 7
            candidate = _at_local(now_local + timedelta(days=ahead), hour, minute)
            if candidate <= now_local:
                candidate = _at_local(candidate + timedelta(days=7), hour, minute)
        return When(at=candidate) if candidate > now_local else None

    if kind == "clock":
        if clock is None:
            return None
        hour, minute = clock
        candidate = _at_local(now_local, hour, minute)
        # "at 9" after nine in the morning means nine tomorrow. Guessing the other way
        # would schedule something for a moment that has already gone.
        if candidate <= now_local:
            candidate = _at_local(now_local + timedelta(days=1), hour, minute)
        return When(at=candidate)

    return None


def parse_when(phrase: str, *, now: datetime, timezone: str) -> When | None:
    """A whole phrase read as a moment, or None. The phrase must be only the time."""
    zone = zone_for(timezone)
    now_local = now.astimezone(zone)
    text = " ".join(phrase.lower().split())
    if not text:
        return None

    for kind, pattern in _PATTERNS:
        match = re.fullmatch(pattern, text)
        if match:
            resolved = _resolve(match, kind, now_local)
            if resolved is not None:
                return resolved
    return None


def parse_reminder(text: str, *, now: datetime, timezone: str) -> Reminder | None:
    """`water the plants tomorrow at 9` → the words and the moment, or None.

    The time is looked for at the end first and then at the start, longest match first,
    because that is where people put it and because a greedy search in the middle turns
    "tell Ana at the standup" into a reminder for an hour nobody named.
    """
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return None

    # "remind me to X" and "remind me X" both arrive here as "me to X" / "me X".
    lead = re.match(r"(?:me\s+)?(?:to\s+)?", cleaned, re.IGNORECASE)
    if lead:
        cleaned = cleaned[lead.end() :].strip()
    if not cleaned:
        return None

    lowered = cleaned.lower()

    for kind, pattern in _PATTERNS:
        # At the end.
        tail = re.search(rf"\s+({pattern})$", lowered)
        if tail:
            match = re.fullmatch(pattern, tail.group(1))
            resolved = _resolve(match, kind, now.astimezone(zone_for(timezone))) if match else None
            if resolved is not None:
                body = cleaned[: tail.start()].strip()
                if body:
                    return Reminder(body=body, at=resolved.at, repeat=resolved.repeat)

        # At the start.
        head = re.match(rf"({pattern})\s+", lowered)
        if head:
            match = re.fullmatch(pattern, head.group(1))
            resolved = _resolve(match, kind, now.astimezone(zone_for(timezone))) if match else None
            if resolved is not None:
                body = cleaned[head.end() :].strip()
                if body:
                    return Reminder(body=body, at=resolved.at, repeat=resolved.repeat)

    return None


def as_utc(moment: datetime) -> datetime:
    """The same instant, in UTC, which is what the schedule row stores."""
    return moment.astimezone(UTC)


__all__ = [
    "DEFAULT_HOUR",
    "Reminder",
    "When",
    "as_utc",
    "parse_reminder",
    "parse_when",
    "zone_for",
]
