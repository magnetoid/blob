"""Asking an app to answer a slash command.

Unlike an event, a command is *synchronous to a person*. Someone typed it and is watching
the composer, so this does not go through the outbox: it is one signed request with a
short timeout, and the answer comes back on the same connection.

That timeout is the whole design constraint, and it is Slack's answer because Slack's
answer is right. An app has a couple of seconds to say something. If it needs longer it
answers `202` with an empty body, keeps the `responseUrl` it was given, and posts the
real answer there when it has one. The alternative — holding the request open while an
agent thinks — ties up a connection per command and still fails at whatever timeout the
proxy in front has.

The response URL is a signed token rather than a row. What it has to carry is small and
fixed (which app, which channel, on whose behalf, until when), it is used a handful of
times within minutes, and a table would need sweeping. The signature is over the same
secret the session cookie uses, so forging one is forging a session.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx

from ..config import settings
from .signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, sign

#: How long an app has to answer before Blob tells the person it is still working.
#: Slack allows three seconds and every app author has already been told that number.
REQUEST_TIMEOUT_SEC = 3.0

#: How long a `responseUrl` keeps working. Long enough for an agent to think, short
#: enough that a leaked URL stops being useful quickly.
RESPONSE_TTL_SEC = 1800

ResponseType = Literal["ephemeral", "in_channel"]


@dataclass(slots=True)
class AppReply:
    """What an app said. `None` in place of this means "later" — see `parse_reply`."""

    response_type: ResponseType
    text: str


@dataclass(slots=True)
class ResponseTarget:
    """Where a deferred answer is allowed to land, recovered from a response token."""

    plugin_id: str
    channel_id: str
    user_id: str


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def response_token(*, plugin_id: str, channel_id: str, user_id: str, now: int | None = None) -> str:
    """A bearer URL segment authorising exactly one app to answer exactly one command."""
    payload = {
        "p": plugin_id,
        "c": channel_id,
        "u": user_id,
        "e": (now if now is not None else int(time.time())) + RESPONSE_TTL_SEC,
    }
    body = _b64(json.dumps(payload, separators=(",", ":")).encode())
    mac = hmac.new(settings.SESSION_SECRET.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(mac)}"


def verify_response_token(token: str, *, now: int | None = None) -> ResponseTarget | None:
    """Recover the target, or None for anything forged, malformed or expired.

    One return for every failure on purpose: telling a caller *why* its token was refused
    tells an attacker which half to keep guessing at.
    """
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(
            settings.SESSION_SECRET.encode(), body.encode(), hashlib.sha256
        ).digest()
        if not hmac.compare_digest(_unb64(signature), expected):
            return None

        payload = json.loads(_unb64(body))
        if int(payload["e"]) < (now if now is not None else int(time.time())):
            return None
        return ResponseTarget(
            plugin_id=str(payload["p"]),
            channel_id=str(payload["c"]),
            user_id=str(payload["u"]),
        )
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def parse_reply(status_code: int, body: bytes) -> AppReply | None:
    """Read what an app sent back.

    `None` means "nothing to show yet" and covers every shape of that: an explicit 202, an
    empty body, or a reply whose text is blank. All three mean the same thing to the
    person waiting, so they get the same answer.

    An app that sends something unparseable is treated the same way rather than shown a
    parser error, because the person who typed the command did not write the app and
    cannot act on its JSON being wrong. The delivery log is where that belongs.
    """
    if status_code == 202 or not body.strip():
        return None

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    text_value = parsed.get("text")
    if not isinstance(text_value, str) or not text_value.strip():
        return None

    declared = parsed.get("responseType")
    response_type: ResponseType = "in_channel" if declared == "in_channel" else "ephemeral"
    return AppReply(response_type=response_type, text=text_value)


async def ask(
    *,
    url: str,
    secret: str,
    payload: dict[str, Any],
) -> tuple[AppReply | None, str | None]:
    """Ask an app to answer a command.

    Returns `(reply, error)`. An error is a string for the delivery log, never something
    the person who ran the command is shown verbatim — an app's stack trace is not an
    answer to `/deploy`.
    """
    body = json.dumps(payload, separators=(",", ":")).encode()
    timestamp = int(time.time())
    headers = {
        "content-type": "application/json",
        TIMESTAMP_HEADER: str(timestamp),
        SIGNATURE_HEADER: sign(secret, timestamp, body),
        "user-agent": "blob-plugins/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SEC, follow_redirects=False) as client:
            response = await client.post(url, content=body, headers=headers)
    except httpx.TimeoutException:
        # Not a failure. A slow app is the case `responseUrl` exists for, and the person
        # is told it is working rather than told it broke.
        return None, "timeout"
    except httpx.HTTPError as exc:
        return None, str(exc)[:500]

    if response.status_code >= 400:
        return None, f"{response.status_code}: {response.text[:200]}"

    return parse_reply(response.status_code, response.content), None
