"""The credentials a person's assistant holds (ADR 0016).

An MCP token resolves to a *user*, not a bot, so an assistant acting for somebody has
exactly that person's reach and shows up in the audit log as them. Minting and revoking
are audited for the same reason: it is a credential that acts as a person, and an admin
reading the log should see that one was made, by whom, and whether it could write.
Resolving a token on a request is `services/mcp.py`'s.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser, hash_token
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id, new_token
from . import audit as audit_service


def _actor(user: SessionUser) -> audit_service.Actor:
    return audit_service.Actor(id=user.id, workspace_id=user.workspace_id)


async def list_for(session: AsyncSession, user_id: str) -> list[Any]:
    """This person's live tokens, newest first. Revoked ones are gone from the list."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT id, name, scopes, created_at, last_used_at
                      FROM mcp_tokens
                     WHERE user_id = :user_id AND revoked_at IS NULL
                     ORDER BY created_at DESC
                    """
                ),
                {"user_id": user_id},
            )
        ).fetchall()
    )


async def mint(
    session: AsyncSession, user: SessionUser, *, name: str, can_write: bool
) -> tuple[Any, str]:
    """A new token for this person. Returns the row and the secret, shown once."""
    secret = new_token()
    token_id = new_id()
    scopes = ["read", "write"] if can_write else ["read"]
    row = (
        await session.execute(
            text(
                """
                INSERT INTO mcp_tokens (id, workspace_id, user_id, name, token_hash, scopes)
                VALUES (:id, :ws, :user_id, :name, :hash, :scopes)
                RETURNING id, name, scopes, created_at, last_used_at
                """
            ),
            {
                "id": token_id,
                "ws": user.workspace_id,
                "user_id": user.id,
                "name": name,
                "hash": hash_token(secret),
                "scopes": scopes,
            },
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not create that connection.")
    await audit_service.record(
        session,
        _actor(user),
        "mcp_token.created",
        target_type="mcp_token",
        target_id=token_id,
        metadata={"name": name, "scopes": scopes},
    )
    return row, secret


async def revoke(session: AsyncSession, user: SessionUser, token_id: str) -> None:
    """Scoped to the owner, so a token id learned from somewhere else revokes nothing."""
    revoked = (
        await session.execute(
            text(
                """
                UPDATE mcp_tokens SET revoked_at = now()
                 WHERE id = :id AND user_id = :user_id AND revoked_at IS NULL
                 RETURNING id
                """
            ),
            {"id": token_id, "user_id": user.id},
        )
    ).fetchone()
    if revoked is None:
        raise not_found("There is no connection with that id.")
    await audit_service.record(
        session,
        _actor(user),
        "mcp_token.revoked",
        target_type="mcp_token",
        target_id=token_id,
    )
