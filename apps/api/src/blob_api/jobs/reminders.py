"""Fire the reminders people set on saved messages.

Runs every minute. A due reminder inside the person's quiet hours is *deferred* — the
row stays armed and fires when their window opens — rather than dropped or pushed
through: "remind me" and "do not disturb me" are both instructions, and the second one
wins on timing while the first survives it.

`FOR UPDATE SKIP LOCKED` so two workers cannot fire the same reminder twice, and
`reminded_at` is the ratchet that makes each one fire at most once ever.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.queue import fire_and_forget
from ..lib.webpush import send_push
from ..realtime import hub
from ..schemas.models import UserPrefs
from ..services import notify as notify_service

log = logging.getLogger("blob.jobs.reminders")

BATCH = 100


async def fire_reminders(_ctx: dict[str, Any]) -> None:
    now = datetime.now(UTC)
    async with transaction() as (session, after):
        rows = (
            await session.execute(
                text(
                    """
                    SELECT s.user_id, s.message_id, s.note,
                           m.channel_id, m.thread_root_id,
                           u.prefs, u.timezone
                      FROM saved_items s
                      JOIN messages m ON m.id = s.message_id AND m.deleted_at IS NULL
                      JOIN users u ON u.id = s.user_id AND u.deactivated_at IS NULL
                     WHERE s.remind_at <= now() AND s.reminded_at IS NULL
                     FOR UPDATE OF s SKIP LOCKED
                     LIMIT :batch
                    """
                ),
                {"batch": BATCH},
            )
        ).fetchall()

        for row in rows:
            recipient = notify_service.Recipient(
                user_id=str(row.user_id),
                prefs=UserPrefs.model_validate(row.prefs or {}),
                timezone=row.timezone or "UTC",
            )
            if notify_service.is_snoozed(recipient, now):
                continue  # Deferred: still armed, fires when the window opens.

            await session.execute(
                text(
                    """
                    UPDATE saved_items SET reminded_at = now()
                     WHERE user_id = :user_id AND message_id = :message_id
                    """
                ),
                {"user_id": row.user_id, "message_id": row.message_id},
            )

            event = {
                "t": "reminder.due",
                "messageId": str(row.message_id),
                "channelId": str(row.channel_id),
                "note": row.note,
            }
            after.add(_deliver_later(str(row.user_id), event, row.note))


def _deliver_later(user_id: str, event: dict[str, Any], note: str | None) -> Any:
    """Bind the loop variables now, so the after-commit callback sees this row's."""

    def run() -> None:
        hub.to_users([user_id], event)
        fire_and_forget(_push_reminder(user_id, note))

    return run


async def _push_reminder(user_id: str, note: str | None) -> None:
    """The push half, outside every transaction — it is a fan-out of remote calls."""
    from ..config import settings

    if not settings.push_enabled:
        return
    async with session_scope() as session:
        subs = (
            await session.execute(
                text(
                    """
                    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
                     WHERE user_id = :id
                    """
                ),
                {"id": user_id},
            )
        ).fetchall()
    if not subs:
        return
    dead = await send_push(
        subs,
        {
            "title": "Reminder",
            "body": note or "You asked to come back to a message.",
            "url": "/later",
            "tag": "reminder",
        },
    )
    if dead:
        async with transaction() as (session, _):
            await session.execute(
                text("DELETE FROM push_subscriptions WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": dead},
            )


__all__ = ["fire_reminders"]
