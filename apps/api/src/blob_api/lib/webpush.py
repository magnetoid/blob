"""Web push fan-out, shared by the notify job and the settings screen's test button.

Two failures used to be invisible here. A bad `VAPID_PRIVATE_KEY` or a `VAPID_SUBJECT`
without its `mailto:` raises `VapidException`, not `WebPushException`, so it slipped past
the one `except`, was swallowed by `gather(return_exceptions=True)`, and left no log line
at all — while the test button, which counts everything that was not *rejected* as
delivered, said it had sent. And `webpush` was called with no `timeout`, which is not the
library's ten seconds but no timeout at all: one unresponsive push service pinned a
worker thread for good, out of the eight the worker has.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from ..config import settings

log = logging.getLogger("blob.lib.webpush")


#: How long one push may take. `pywebpush` does not default this — passing nothing means
#: `requests` waits for ever, on a thread the worker cannot get back.
PUSH_TIMEOUT_SEC = 10

#: The push services browsers subscribe through: Google's (Chrome, Edge on Android,
#: Opera, Samsung), Mozilla's, Apple's and Microsoft's. A subscription's endpoint is a URL
#: the browser hands over and the worker then POSTs to, so it is held to these — anything
#: else is a person pointing the worker at an address of their choosing, the metadata
#: service or this stack's own Redis included (the 2026-10 security review).
PUSH_SERVICES = (
    "googleapis.com",
    "mozilla.com",
    "mozaws.net",
    "push.apple.com",
    "notify.windows.com",
)


def is_push_service(endpoint: str) -> bool:
    """Whether a subscription points at a browser's push service, over HTTPS."""
    try:
        parts = urlsplit(endpoint)
        port = parts.port
    except ValueError:
        return False
    host = (parts.hostname or "").lower().rstrip(".")
    if parts.scheme != "https" or parts.username or parts.password or port not in (None, 443):
        return False
    return any(host == service or host.endswith("." + service) for service in PUSH_SERVICES)


@dataclass(slots=True)
class PushResult:
    """What became of a fan-out: what landed, and what the browser has thrown away."""

    delivered: int
    #: Subscription ids the push service says are gone. The caller deletes them.
    dead: list[str]
    #: Endpoints that failed for any other reason — a bad key, a refusal, a timeout.
    failed: int


async def push(subs: Sequence[Any], payload: dict[str, Any]) -> PushResult:
    """Fan out web push and report honestly what happened to each subscription."""
    from pywebpush import WebPushException, webpush

    def _one(sub: Any) -> str:
        # Held to the push services on the way out too: a row stored before the check
        # existed is dropped as dead rather than sent to.
        if not is_push_service(str(sub.endpoint)):
            log.warning("push subscription %s points outside the push services; dropping", sub.id)
            return "dead"
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
                timeout=PUSH_TIMEOUT_SEC,
            )
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            # 404/410 mean the browser threw the subscription away; stop trying.
            if status in (404, 410):
                return "dead"
            log.warning("push refused for %s: %s", sub.id, exc)
            return "failed"
        except Exception as error:
            # A malformed key or subject lands here, and it fails every push on the
            # server rather than one — so it is logged as itself rather than dropped.
            log.warning("push could not be sent to %s: %r", sub.id, error)
            return "failed"
        return "delivered"

    outcomes = await asyncio.gather(
        *(asyncio.to_thread(_one, sub) for sub in subs), return_exceptions=True
    )
    result = PushResult(delivered=0, dead=[], failed=0)
    for sub, outcome in zip(subs, outcomes, strict=True):
        if outcome == "delivered":
            result.delivered += 1
        elif outcome == "dead":
            result.dead.append(str(sub.id))
        else:
            # An exception that escaped `_one` itself is still a failure, not a delivery.
            if isinstance(outcome, BaseException):
                log.warning("push raised for %s: %r", sub.id, outcome)
            result.failed += 1
    return result


async def send_push(subs: Sequence[Any], payload: dict[str, Any]) -> list[str]:
    """The dead-subscription ids alone, for callers that only prune."""
    return (await push(subs, payload)).dead
