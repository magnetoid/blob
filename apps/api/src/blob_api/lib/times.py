"""Reading a time a client sent.

Four routes took an ISO timestamp and each got it wrong differently, which is what a
fourth copy of the same six lines buys. `schedule` parsed it and refused a naive one.
`later` parsed it and then compared it with an aware `now()`, so a time without a zone
raised `TypeError` *past* the `except ValueError` and answered 500. A task's due date and
a status expiry accepted a naive one and handed it to Postgres, which read it in the
server's zone — so "clear this at 10:00" quietly meant ten o'clock somewhere the person
had never been.

A time without an offset is not a time. It is a reading on a clock, and the server has no
way to know whose. So it is refused here, once, with the sentence `schedule` already
used.
"""

from __future__ import annotations

from datetime import UTC, datetime

from .errors import bad_request


def parse_client_time(raw: str) -> datetime:
    """An aware `datetime`, or a 400 saying which way it was wrong.

    Two failures, told apart because the fixes are different: text that is not a
    timestamp at all, and a timestamp with no zone on it.
    """
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise bad_request("That isn't a time.") from None
    if parsed.tzinfo is None:
        raise bad_request("That time needs a time zone.", "invalid_input")
    return parsed


def parse_future_time(raw: str) -> datetime:
    """The same, for a moment that only means anything if it has not happened yet."""
    parsed = parse_client_time(raw)
    if parsed <= datetime.now(UTC):
        raise bad_request("That time has already happened.")
    return parsed
