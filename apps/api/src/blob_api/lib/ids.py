"""Identifiers.

Every primary key is a UUIDv7: time-ordered, so `ORDER BY id` is chronological and
"is there anything newer than what I've read?" is a string comparison rather than a
timestamp join. This is the one schema decision that cannot be retrofitted cheaply.
"""

from __future__ import annotations

import re
import secrets
from typing import Annotated

import uuid_utils
from pydantic import StringConstraints


def new_id() -> str:
    return str(uuid_utils.uuid7())


def new_token(nbytes: int = 32) -> str:
    """URL-safe opaque token for sessions, invites, resets and webhooks."""
    return secrets.token_urlsafe(nbytes)


#: A path parameter that has to be one of our ids.
#:
#: Without it a malformed id went straight into SQL and Postgres answered
#: `invalid input syntax for type uuid`, which surfaced as a 500 with a stack trace in
#: the log — for what is plainly a client mistake. Ten of eleven id-taking endpoints did
#: that, so `/api/messages/notauuid` was an "internal error" and every scanner that
#: walked the API produced one.
#:
#: The shape is checked rather than the value parsed, because the id stays a `str`
#: everywhere downstream: the hand-written SQL casts it, the services compare it, and
#: turning it into a `UUID` object here would ripple through all of them for no gain.
#: FastAPI answers a failed constraint with 422 and `main.py` remaps that to 400
#: `invalid_input`, which is the contract the client already branches on.
#:
#: A well-formed id that names nothing still answers 404 — "not a resource" and "no such
#: resource" are different questions and the second one is the one privacy depends on.
#: The same shape as a plain pattern, for the places a `StringConstraints` cannot reach —
#: a WebSocket frame is not a request body and has no schema layer to refuse it.
ID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

#: `\Z` and not the pattern's own `$`. Python's `$` matches before a trailing newline as
#: well as at the end, so `"<a real uuid>\n"` passed a check whose whole job is to keep a
#: string Postgres will refuse out of `cast(:ids AS uuid[])`. Pydantic compiles the same
#: pattern with Rust's regex crate, where `$` is end-of-haystack, so `IdParam` never had
#: the hole — which is exactly why it went unnoticed here.
_ID_RE = re.compile(ID_PATTERN.replace("$", r"\Z"))

IdParam = Annotated[str, StringConstraints(pattern=ID_PATTERN)]


def looks_like_id(value: object) -> bool:
    """Is this the shape of an id? For frames, which arrive without a schema."""
    return isinstance(value, str) and _ID_RE.match(value) is not None
