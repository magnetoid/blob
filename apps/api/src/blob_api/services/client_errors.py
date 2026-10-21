"""Errors the client threw in somebody's browser, kept where the workspace's admins can see
them (ADR 0025's addendum).

A report is cut down before it is kept: a URL loses its query string and fragment, an
address becomes `[email]`, an id becomes `{id}`, and anything long enough to be a token
becomes `[redacted]` — a stack trace quotes the page it was on, and a page's address can
carry a search or an invitation. Reports of the same fault are one entry, counted: the
fingerprint is the cleaned message and the first frame of the stack. A workspace keeps its
hundred most recently seen faults, for thirty days after the last one.

Kept in Redis, not the database: it is a diagnostic ring, like the server's log buffer, and
losing it loses nothing anybody wrote.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import Any

from ..lib.redis import redis

#: Faults a workspace keeps, newest seen first.
KEEP = 100
TTL_SEC = 30 * 24 * 3600
#: Lines of a stack kept: enough to find the place, not a copy of the bundle.
STACK_LINES = 12

_URL_TAIL = re.compile(r"(https?://[^\s?#'\"()<>]+)[?#][^\s'\"()<>]*")
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_ID = re.compile(r"\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b")
_TOKEN = re.compile(r"[A-Za-z0-9_\-]{32,}")
_BROWSERS = (
    ("Edge", re.compile(r"Edg/(\d+)")),
    ("Firefox", re.compile(r"Firefox/(\d+)")),
    ("Chrome", re.compile(r"Chrome/(\d+)")),
    ("Safari", re.compile(r"Version/(\d+)[\d.]* .*Safari/")),
)


def redact(text: str) -> str:
    """What may be kept of a line a browser sent."""
    text = _URL_TAIL.sub(r"\1", text)
    text = _EMAIL.sub("[email]", text)
    text = _ID.sub("{id}", text)
    return _TOKEN.sub("[redacted]", text)


def browser_of(user_agent: str) -> str:
    """ "Chrome 130", "Safari 18" — the family and major version, nothing more."""
    for name, pattern in _BROWSERS:
        found = pattern.search(user_agent)
        if found:
            return f"{name} {found.group(1)}"
    return "Other"


@dataclass(frozen=True, slots=True)
class Fault:
    fingerprint: str
    message: str
    stack: str
    path: str
    release: str | None
    browser: str
    count: int
    first_at: float
    last_at: float


def _keys(workspace_id: str) -> tuple[str, str, str]:
    base = f"client_errors:{workspace_id}"
    return f"{base}:detail", f"{base}:count", f"{base}:seen"


async def record(
    workspace_id: str,
    *,
    message: str,
    stack: str | None,
    path: str,
    release: str | None,
    user_agent: str,
) -> str:
    """Keep one report: the first of its kind in full, later ones as a count and a time."""
    clean_message = redact(message.strip())[:500] or "(no message)"
    lines = [redact(line.rstrip()) for line in (stack or "").splitlines() if line.strip()]
    clean_stack = "\n".join(lines[:STACK_LINES])[:4000]
    frame = next((line for line in lines if "at " in line or "@" in line), "")
    fingerprint = hashlib.sha1(  # noqa: S324 — a grouping key, not a secret
        f"{clean_message}\n{frame.strip()}".encode()
    ).hexdigest()[:16]
    now = time.time()
    detail_key, count_key, seen_key = _keys(workspace_id)
    detail = json.dumps(
        {
            "message": clean_message,
            "stack": clean_stack,
            "path": redact(path)[:300],
            "release": (release or "")[:64] or None,
            "browser": browser_of(user_agent),
            "firstAt": now,
        }
    )
    pipe = redis.pipeline(transaction=False)
    pipe.hsetnx(detail_key, fingerprint, detail)
    pipe.hincrby(count_key, fingerprint, 1)
    pipe.zadd(seen_key, {fingerprint: now})
    for key in (detail_key, count_key, seen_key):
        pipe.expire(key, TTL_SEC)
    pipe.zcard(seen_key)
    *_, kept = await pipe.execute()
    if int(kept) > KEEP:
        oldest: list[str] = await redis.zrange(seen_key, 0, int(kept) - KEEP - 1)
        if oldest:
            trim = redis.pipeline(transaction=False)
            trim.zrem(seen_key, *oldest)
            trim.hdel(detail_key, *oldest)
            trim.hdel(count_key, *oldest)
            await trim.execute()
    return fingerprint


async def recent(workspace_id: str, *, limit: int = 50) -> list[Fault]:
    detail_key, count_key, seen_key = _keys(workspace_id)
    seen: list[tuple[str, float]] = await redis.zrevrange(seen_key, 0, limit - 1, withscores=True)
    if not seen:
        return []
    fingerprints = [fingerprint for fingerprint, _ in seen]
    details: list[Any] = await redis.hmget(detail_key, fingerprints)  # type: ignore[misc]
    counts: list[Any] = await redis.hmget(count_key, fingerprints)  # type: ignore[misc]
    faults: list[Fault] = []
    for (fingerprint, last_at), raw, count in zip(seen, details, counts, strict=True):
        if raw is None:
            continue
        try:
            stored = json.loads(raw)
        except ValueError:
            continue
        faults.append(
            Fault(
                fingerprint=fingerprint,
                message=str(stored.get("message", "")),
                stack=str(stored.get("stack", "")),
                path=str(stored.get("path", "")),
                release=stored.get("release"),
                browser=str(stored.get("browser", "Other")),
                count=int(count or 0),
                first_at=float(stored.get("firstAt") or last_at),
                last_at=float(last_at),
            )
        )
    return faults


async def clear(workspace_id: str) -> None:
    await redis.delete(*_keys(workspace_id))


__all__ = ["KEEP", "Fault", "browser_of", "clear", "recent", "record", "redact"]
