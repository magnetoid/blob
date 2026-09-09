"""Forget rows that have already done their job.

Sessions expire; the resolver already ignores them. Password-reset tokens expire; the
redeem path already ignores them. Plugin deliveries that landed (or were given up on)
and audit events past the workspace's retention are the same shape: they stay forever
unless something deletes them. This is that something.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from ..db.engine import transaction
from ..services.workspace_settings import DEFAULT_RETENTION_DAYS, load_retention_days

log = logging.getLogger("blob.jobs.retention")

#: Delivered/dead outbox rows past this are history nobody reads.
DELIVERY_KEEP_DAYS = 30


async def sweep_retention() -> dict[str, int]:
    retention_days = await load_retention_days()
    counts = {"sessions": 0, "password_resets": 0, "deliveries": 0, "audit": 0}
    async with transaction() as (session, _):
        counts["sessions"] = (
            await session.execute(text("DELETE FROM sessions WHERE expires_at < now()"))
        ).rowcount or 0
        counts["password_resets"] = (
            await session.execute(
                text(
                    """
                    DELETE FROM password_resets
                     WHERE expires_at < now()
                        OR (used_at IS NOT NULL AND used_at < now() - interval '7 days')
                    """
                )
            )
        ).rowcount or 0
        counts["deliveries"] = (
            await session.execute(
                text(
                    """
                    DELETE FROM plugin_deliveries
                     WHERE status IN ('delivered', 'dead')
                       AND created_at < now() - make_interval(days => :days)
                    """
                ),
                {"days": DELIVERY_KEEP_DAYS},
            )
        ).rowcount or 0
        counts["audit"] = (
            await session.execute(
                text(
                    """
                    DELETE FROM audit_events
                     WHERE created_at < now() - make_interval(days => :days)
                    """
                ),
                {"days": retention_days or DEFAULT_RETENTION_DAYS},
            )
        ).rowcount or 0
    removed = sum(counts.values())
    if removed:
        log.info("swept expired rows: %s", counts)
    return counts
