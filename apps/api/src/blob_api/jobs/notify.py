"""Deliver notifications for one message.

Runs after the send transaction has committed, so it reads its own consistent view and
never blocks the sender. Push is suppressed for anyone with the channel already on
screen — they have seen the message.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db.engine import transaction
from ..lib.webpush import send_push
from ..realtime import presence
from ..schemas.models import ReadStateOut
from ..services import notify as notify_service
from ..services import read_state as read_state_service

log = logging.getLogger("blob.jobs.notify")


def _broadcast_later(user_id: str, state: ReadStateOut) -> Callable[[], None]:
    """Bind the loop variables now, so the after-commit callback sees this pair."""

    def run() -> None:
        read_state_service.broadcast(user_id, state)

    return run


def _preview(body: str) -> str:
    flat = " ".join(body.split())
    return f"{flat[:117]}…" if len(flat) > 120 else flat


async def handle_notify(message_id: str) -> None:
    async with transaction() as (session, after):
        message = (
            await session.execute(
                text(
                    """
                    SELECT m.id, m.channel_id, c.kind AS channel_kind, c.name AS channel_name,
                           m.author_id, u.display_name AS author_name, m.body,
                           m.mention_user_ids, m.mention_group_ids, m.mentions_everyone,
                           m.thread_root_id
                      FROM messages m
                      JOIN channels c ON c.id = m.channel_id
                      LEFT JOIN users u ON u.id = m.author_id
                     WHERE m.id = :id AND m.deleted_at IS NULL
                    """
                ),
                {"id": message_id},
            )
        ).fetchone()
        if message is None:
            return

        recipients = await notify_service.load_recipients(session, message.channel_id)
        subscribers = (
            await notify_service.load_thread_subscribers(session, message.thread_root_id)
            if message.thread_root_id
            else set()
        )

        # Intersected with channel membership for free: `decide` iterates only the
        # recipients loaded above, so a group member who is not in this channel is never
        # considered. That bound is the privacy posture — a notification carries the
        # channel name and a body preview, and tapping it would 404.
        group_recipients = await notify_service.load_group_recipients(
            session, list(message.mention_group_ids or [])
        )

        decisions = notify_service.decide(
            notify_service.NotifiableMessage(
                id=message.id,
                channel_id=message.channel_id,
                channel_kind=message.channel_kind,
                author_id=message.author_id,
                body=message.body,
                mention_user_ids=list(message.mention_user_ids or []),
                mention_group_ids=list(message.mention_group_ids or []),
                mentions_everyone=message.mentions_everyone,
                thread_root_id=message.thread_root_id,
            ),
            recipients,
            thread_subscribers=subscribers,
            group_recipients=group_recipients,
        )
        if not decisions:
            return

        mention_ids = [d.user_id for d in decisions if d.counts_as_mention]
        states = await read_state_service.increment_mentions(
            session, mention_ids, message.channel_id
        )
        for user_id, state in zip(mention_ids, states, strict=False):
            after.add(_broadcast_later(user_id, state))

        subs: Sequence[Any] = []
        if settings.push_enabled:
            subs = (
                await session.execute(
                    text(
                        """
                        SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions
                         WHERE user_id = ANY(cast(:ids AS uuid[]))
                        """
                    ),
                    {"ids": [d.user_id for d in decisions]},
                )
            ).fetchall()

    # The transaction above is closed on purpose: push is a fan-out of remote calls,
    # and holding a Postgres connection open across them blocks vacuum and ties up the
    # pool for however long the slowest push provider feels like taking.
    if not subs:
        return

    # Someone looking at this very channel has already seen it; don't push at them.
    # The focus registry lives in Redis because this code runs in the worker, which
    # holds no sockets — the process-local answer here is always "nobody is looking".
    targets = []
    focused: dict[str, bool] = {}
    for sub in subs:
        user_id = str(sub.user_id)
        if user_id not in focused:
            focused[user_id] = message.channel_id in await presence.focused_channels(user_id)
        if not focused[user_id]:
            targets.append(sub)
    if not targets:
        return

    is_dm = message.channel_kind in ("dm", "group_dm")
    title = (
        (message.author_name or "New message") if is_dm else f"#{message.channel_name or 'channel'}"
    )
    prefix = f"{message.author_name}: " if message.author_name else ""
    payload = {
        "title": title,
        "body": f"{prefix}{_preview(message.body)}",
        "url": f"/c/{message.channel_id}",
        "tag": message.channel_id,
    }
    dead = await send_push(targets, payload)
    if dead:
        async with transaction() as (session, _after):
            await session.execute(
                text("DELETE FROM push_subscriptions WHERE id = ANY(cast(:ids AS uuid[]))"),
                {"ids": dead},
            )
