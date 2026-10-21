"""Email when you are away (M3 · B3, ADR 0036).

Slack's habit, kept to its narrowest form: when something is addressed to you — a DM, a
mention of you or of a group you are in, a reply in a thread you follow — and you have
no Blob open anywhere, it waits; if it is still unread when your window has passed (15
minutes, or an hour), one email lists everything that waited. A broadcast (`@channel`)
or a keyword is never mailed, nobody gets one about a room they have since left, and a
person who comes back before the window ends gets nothing at all: Blob shows them what
is unread itself.

The queue (`notification_mail`) is written by the notify job and drained by
`jobs/away_mail.py`. Every link out of an email is to the app; the unsubscribe link is
the one thing that works without signing in, and all it can do is turn this off.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.times import clock_length

#: What a person may be emailed about. The rest of `notify.decide`'s reasons — a keyword,
#: `@channel`, every message in a busy channel — are interruptions people chose for the
#: app, not for their inbox.
MAILED_REASONS = ("dm", "mention", "group", "thread")

EmailWhenAway = Literal["quarter_hour", "hourly", "off"]
WINDOWS: dict[str, timedelta] = {
    "quarter_hour": timedelta(minutes=15),
    "hourly": timedelta(hours=1),
}
#: A message that has waited this long is not news any more; it leaves the queue unsent.
KEEP = timedelta(hours=24)
#: How many messages one email lists before it says how many more there are.
LISTED = 8
#: How many people one tick of the job looks at.
BATCH = 200

#: What the stored preference is when a person never chose: Slack's default.
DEFAULT: EmailWhenAway = "quarter_hour"


# ─── the queue ────────────────────────────────────────────────────────────────────────


async def queue(session: AsyncSession, message_id: str, reasons: Iterable[tuple[str, str]]) -> None:
    """Hold this message for the people it was addressed to, as (user id, reason).

    The caller has already left out whoever is at their desk. This leaves out the rest
    who would never get the email anyway: an agent, a deactivated account, somebody who
    turned it off. A message queued twice for one person stays once.
    """
    pairs = [(user_id, reason) for user_id, reason in reasons if reason in MAILED_REASONS]
    if not pairs:
        return
    await session.execute(
        text(
            """
            INSERT INTO notification_mail (user_id, message_id, reason)
            SELECT u.id, :message_id, r.reason
              FROM unnest(cast(:ids AS uuid[]), cast(:reasons AS text[])) AS r(user_id, reason)
              JOIN users u ON u.id = r.user_id
             WHERE u.bot_plugin_id IS NULL
               AND u.deactivated_at IS NULL
               AND coalesce(u.prefs->>'emailWhenAway', :default) <> 'off'
            ON CONFLICT DO NOTHING
            """
        ),
        {
            "message_id": message_id,
            "ids": [user_id for user_id, _ in pairs],
            "reasons": [reason for _, reason in pairs],
            "default": DEFAULT,
        },
    )


@dataclass(slots=True)
class Person:
    user_id: str
    email: str
    display_name: str
    timezone: str
    prefs: dict[str, Any]
    workspace_name: str


async def due(session: AsyncSession, now: datetime) -> list[Person]:
    """Who has had something waiting for at least their window, oldest wait first."""
    rows = (
        await session.execute(
            text(
                """
                SELECT u.id, u.email, u.display_name, u.timezone, u.prefs,
                       w.name AS workspace_name
                  FROM (SELECT user_id, min(queued_at) AS oldest
                          FROM notification_mail GROUP BY user_id) q
                  JOIN users u ON u.id = q.user_id
                  JOIN workspaces w ON w.id = u.workspace_id
                 WHERE u.deactivated_at IS NULL
                   AND q.oldest <= cast(:now AS timestamptz) - CASE
                         coalesce(u.prefs->>'emailWhenAway', :default)
                         WHEN 'hourly' THEN interval '1 hour'
                         ELSE interval '15 minutes'
                       END
                 ORDER BY q.oldest
                 LIMIT :batch
                """
            ),
            {"now": now, "default": DEFAULT, "batch": BATCH},
        )
    ).fetchall()
    return [
        Person(
            user_id=str(row.id),
            email=row.email,
            display_name=row.display_name,
            timezone=row.timezone or "UTC",
            prefs=dict(row.prefs or {}),
            workspace_name=row.workspace_name,
        )
        for row in rows
    ]


async def waiting(session: AsyncSession, user_id: str) -> list[Any]:
    """What is still worth an email, oldest first: unread, not deleted, and in a room the
    person is still in.

    A reply counts as read once its thread is read up to it, or once the channel is, if it
    was also sent there. A mention or a DM inside a thread the person does not follow has
    no thread cursor to read — reading such a thread records nothing — but it counted on
    the channel's badge, and reading the channel clears that: cleared since it arrived,
    it has been seen."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT nm.message_id, nm.reason, m.channel_id, m.thread_root_id,
                           m.body, m.created_at, c.name AS channel_name,
                           c.kind AS channel_kind, a.display_name AS author_name,
                           (SELECT f.duration_ms FROM attachments f
                             WHERE f.message_id = m.id AND f.kind = 'voice'
                             ORDER BY f.id LIMIT 1) AS voice_ms,
                           (SELECT count(*) FROM attachments f
                             WHERE f.message_id = m.id) AS files
                      FROM notification_mail nm
                      JOIN messages m ON m.id = nm.message_id AND m.deleted_at IS NULL
                      JOIN channels c ON c.id = m.channel_id
                      JOIN channel_members cm
                        ON cm.channel_id = m.channel_id AND cm.user_id = nm.user_id
                      LEFT JOIN users a ON a.id = m.author_id
                      LEFT JOIN read_states rs
                        ON rs.channel_id = m.channel_id AND rs.user_id = nm.user_id
                      LEFT JOIN thread_subscriptions ts
                        ON ts.thread_root_id = m.thread_root_id AND ts.user_id = nm.user_id
                     WHERE nm.user_id = :user_id
                       AND CASE
                             WHEN m.thread_root_id IS NULL THEN
                               rs.last_read_message_id IS NULL
                               OR rs.last_read_message_id < m.id
                             WHEN ts.last_read_reply_id IS NOT NULL
                                  AND ts.last_read_reply_id >= m.id THEN false
                             WHEN m.also_in_channel
                                  AND rs.last_read_message_id IS NOT NULL
                                  AND rs.last_read_message_id >= m.id THEN false
                             WHEN nm.reason <> 'thread'
                                  AND rs.mention_count = 0
                                  AND rs.updated_at >= m.created_at THEN false
                             ELSE true
                           END
                     ORDER BY m.id
                    """
                ),
                {"user_id": user_id},
            )
        ).fetchall()
    )


async def clear(session: AsyncSession, user_id: str, *, up_to: datetime) -> None:
    """Forget what this person had waiting, as of `up_to` — anything queued since stays
    for the next window."""
    await session.execute(
        text(
            """
            DELETE FROM notification_mail
             WHERE user_id = :user_id AND queued_at <= cast(:up_to AS timestamptz)
            """
        ),
        {"user_id": user_id, "up_to": up_to},
    )


async def expire(session: AsyncSession, now: datetime) -> None:
    await session.execute(
        text("DELETE FROM notification_mail WHERE queued_at < cast(:cutoff AS timestamptz)"),
        {"cutoff": now - KEEP},
    )


# ─── the email ────────────────────────────────────────────────────────────────────────


@dataclass(slots=True)
class Email:
    subject: str
    body: str
    headers: dict[str, str]


def compose(person: Person, items: Sequence[Any]) -> Email:
    """One email for everything that waited, in plain text like every mail Blob sends."""
    base = settings.PUBLIC_URL.rstrip("/")
    zone = _zone(person.timezone)
    first = items[0]
    if len(items) == 1:
        subject = _subject_for(first)
    else:
        subject = f"{len(items)} messages waiting for you in {person.workspace_name}"

    lines = [f"Hi {person.display_name},", "", f"While you were away, in {person.workspace_name}:"]
    for item in items[:LISTED]:
        at = item.created_at.astimezone(zone).strftime("%H:%M")
        lines += ["", f"{item.author_name or 'Someone'}, {_where(item)} at {at}"]
        lines.append(_what(item))
        lines.append(f"{base}/m/{item.message_id}")
    if len(items) > LISTED:
        more = len(items) - LISTED
        lines += ["", f"And {more} more: {base}/activity"]

    cadence = "once an hour" if _window_of(person) == "hourly" else "once every 15 minutes"
    token = unsubscribe_token(person.user_id)
    unsubscribe = f"{base}/unsubscribe?t={token}"
    lines += [
        "",
        "--",
        "Blob emails you about direct messages, mentions and replies in threads you follow",
        f"when you have no Blob open, at most {cadence}.",
        f"Change this: {base}/settings/preferences",
        f"Stop these emails: {unsubscribe}",
    ]
    return Email(
        subject=subject,
        body="\n".join(lines) + "\n",
        headers={
            # RFC 8058: a mail client offers "Unsubscribe" and POSTs here, no sign-in.
            "List-Unsubscribe": f"<{base}/api/mail/unsubscribe?t={token}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            # RFC 3834: an out-of-office reply to this would go nowhere useful.
            "Auto-Submitted": "auto-generated",
            "X-Auto-Response-Suppress": "All",
        },
    )


def _subject_for(item: Any) -> str:
    who = item.author_name or "Someone"
    if item.reason == "dm":
        return f"{who} sent you a message"
    if item.reason == "thread":
        return f"{who} replied in a thread you follow"
    where = _room(item)
    if item.reason == "group":
        return f"{who} mentioned a group you are in, in {where}"
    return f"{who} mentioned you in {where}"


def _room(item: Any) -> str:
    if item.channel_kind == "dm":
        return "a direct message"
    if item.channel_kind == "group_dm":
        return "a group message"
    return f"#{item.channel_name}"


def _where(item: Any) -> str:
    room = _room(item)
    return f"in a thread in {room}" if item.thread_root_id else f"in {room}"


def _what(item: Any) -> str:
    flat = " ".join((item.body or "").split())
    if flat:
        return f"{flat[:277]}…" if len(flat) > 280 else flat
    if item.voice_ms is not None:
        return f"Voice message ({clock_length(item.voice_ms)})"
    if item.files:
        return f"{item.files} file{'' if item.files == 1 else 's'}"
    return "(no text)"


def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _window_of(person: Person) -> str:
    value = person.prefs.get("emailWhenAway", DEFAULT)
    return value if value in WINDOWS or value == "off" else DEFAULT


# ─── unsubscribing without signing in ────────────────────────────────────────────────


def _key() -> bytes:
    # Its own key, derived rather than shared: a token minted for one purpose must never
    # verify as another's, whatever shape the two bodies happen to take.
    return hmac.new(
        settings.SESSION_SECRET.encode(), b"blob:mail-unsubscribe", hashlib.sha256
    ).digest()


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def unsubscribe_token(user_id: str) -> str:
    """A link that can do one thing — stop these emails for this account — and never
    expires, because an unsubscribe link that stops working is a spam complaint."""
    body = _b64(json.dumps({"u": user_id, "k": "away"}, separators=(",", ":")).encode())
    mac = hmac.new(_key(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64(mac)}"


def read_unsubscribe_token(token: str) -> str | None:
    """The account a token stops emails for, or None for anything forged or malformed —
    one answer for every failure, so a guesser learns nothing from it."""
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(_key(), body.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64(signature), expected):
            return None
        payload = json.loads(_unb64(body))
        if payload.get("k") != "away":
            return None
        return str(payload["u"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


async def recipient_of(session: AsyncSession, user_id: str) -> Any:
    """Whose emails a token stops, as the page says it: their address and workspace."""
    return (
        await session.execute(
            text(
                """
                SELECT u.id, u.email, w.name AS workspace_name,
                       coalesce(u.prefs->>'emailWhenAway', :default) AS email_when_away
                  FROM users u JOIN workspaces w ON w.id = u.workspace_id
                 WHERE u.id = :id AND u.bot_plugin_id IS NULL
                """
            ),
            {"id": user_id, "default": DEFAULT},
        )
    ).fetchone()


async def turn_off(session: AsyncSession, user_id: str) -> None:
    await session.execute(
        text(
            """
            UPDATE users
               SET prefs = coalesce(prefs, '{}'::jsonb) || '{"emailWhenAway": "off"}'::jsonb
             WHERE id = :id
            """
        ),
        {"id": user_id},
    )
    await session.execute(
        text("DELETE FROM notification_mail WHERE user_id = :id"), {"id": user_id}
    )


__all__ = [
    "BATCH",
    "DEFAULT",
    "KEEP",
    "LISTED",
    "MAILED_REASONS",
    "WINDOWS",
    "Email",
    "EmailWhenAway",
    "Person",
    "clear",
    "compose",
    "due",
    "expire",
    "queue",
    "read_unsubscribe_token",
    "recipient_of",
    "turn_off",
    "unsubscribe_token",
    "waiting",
]
