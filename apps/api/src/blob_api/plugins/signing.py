"""Signing deliveries, and verifying what comes back.

The scheme is Slack's, deliberately: every team that has written a Slack app has already
written this verification code, and a familiar scheme they copy correctly beats a novel
one they implement badly.

    X-Blob-Request-Timestamp: 1755657600
    X-Blob-Signature: v0=<hex hmac-sha256 of "v0:{timestamp}:{raw body}">

The timestamp is inside the signed string, which is what stops a captured request being
replayed later with a fresh header. The `v0=` prefix leaves room to change the algorithm
without ambiguity about which one a given signature used.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

#: How far a delivery's timestamp may be from our clock. Wide enough for ordinary drift,
#: narrow enough that a captured request stops working quickly.
MAX_SKEW_SEC = 300

SIGNATURE_HEADER = "x-blob-signature"
TIMESTAMP_HEADER = "x-blob-request-timestamp"
VERSION = "v0"


def new_secret() -> str:
    """A signing secret. Shown once at install and never recoverable afterwards."""
    return secrets.token_hex(32)


def sign(secret: str, timestamp: int, body: bytes) -> str:
    base = f"{VERSION}:{timestamp}:".encode() + body
    digest = hmac.new(secret.encode(), base, hashlib.sha256).hexdigest()
    return f"{VERSION}={digest}"


def verify(secret: str, timestamp: str | None, signature: str | None, body: bytes) -> bool:
    """Constant-time check of a signature we received.

    Returns False rather than raising, so callers answer every failure the same way and
    a caller cannot learn *which* check failed from the response.
    """
    if not timestamp or not signature:
        return False
    try:
        sent_at = int(timestamp)
    except ValueError:
        return False
    if abs(time.time() - sent_at) > MAX_SKEW_SEC:
        return False
    return hmac.compare_digest(sign(secret, sent_at, body), signature)
