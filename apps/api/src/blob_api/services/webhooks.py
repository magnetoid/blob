"""Incoming webhooks: a token that posts to one channel as the person who made it.

The console's side — listing, minting and revoking — lives in `services/admin.py`
beside the rest of the console. This is the posting side, which has no session and
has to answer for the token alone.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import hash_token


async def by_token(session: AsyncSession, token: str) -> Any:
    """The hook a raw token names, or None. Tokens are stored hashed."""
    return (
        await session.execute(
            text(
                """
                SELECT id, workspace_id, channel_id, created_by, name
                  FROM webhooks WHERE token_hash = :token_hash
                """
            ),
            {"token_hash": hash_token(token)},
        )
    ).fetchone()


async def mark_used(session: AsyncSession, hook_id: str) -> None:
    await session.execute(
        text("UPDATE webhooks SET last_used_at = now() WHERE id = :id"), {"id": hook_id}
    )
