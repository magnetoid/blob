"""The credentials a person's assistant holds (ADR 0016).

An MCP token resolves to a *user*, not a bot, so an assistant acting for somebody has
exactly that person's reach and shows up in the audit log as them. Minting and revoking
are audited for the same reason: it is a credential that acts as a person, and an admin
reading the log should see that one was made, by whom, and whether it could write.
Resolving a token on a request is `services/mcp.py`'s.

Every token ends (migration 0051): its person chooses 30, 90 or 365 days when minting it,
and a token past its date resolves to nobody. An admin sees every live token in the
workspace — whose, what it may do, when it was last used, when it ends — and may revoke
any of them: a credential that acts as a colleague is the workspace's business too.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser, hash_token
from ..lib.errors import bad_request, not_found
from ..lib.ids import new_id, new_token
from . import audit as audit_service

#: The lifetimes a person may choose, in days, and the one they get by default.
LIFETIMES = (30, 90, 365)
DEFAULT_LIFETIME = 90


def _actor(user: SessionUser) -> audit_service.Actor:
    return audit_service.Actor(id=user.id, workspace_id=user.workspace_id)


async def list_for(session: AsyncSession, user_id: str) -> list[Any]:
    """This person's live tokens, newest first. Revoked ones are gone from the list."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT id, name, scopes, created_at, last_used_at, expires_at
                      FROM mcp_tokens
                     WHERE user_id = :user_id AND revoked_at IS NULL
                       -- An assistant that signed in holds an hour-long token minted
                       -- per hour; it is listed once, as a connected app (ADR 0029).
                       AND grant_id IS NULL
                     ORDER BY created_at DESC
                    """
                ),
                {"user_id": user_id},
            )
        ).fetchall()
    )


async def mint(
    session: AsyncSession,
    user: SessionUser,
    *,
    name: str,
    can_write: bool,
    lifetime_days: int = DEFAULT_LIFETIME,
) -> tuple[Any, str]:
    """A new token for this person. Returns the row and the secret, shown once."""
    if lifetime_days not in LIFETIMES:
        raise bad_request("A connection lasts 30, 90 or 365 days.", code="invalid_input")
    secret = new_token()
    token_id = new_id()
    scopes = ["read", "write"] if can_write else ["read"]
    row = (
        await session.execute(
            text(
                """
                INSERT INTO mcp_tokens
                    (id, workspace_id, user_id, name, token_hash, scopes, expires_at)
                VALUES (:id, :ws, :user_id, :name, :hash, :scopes,
                        now() + make_interval(days => :days))
                RETURNING id, name, scopes, created_at, last_used_at, expires_at
                """
            ),
            {
                "id": token_id,
                "ws": user.workspace_id,
                "user_id": user.id,
                "name": name,
                "hash": hash_token(secret),
                "scopes": scopes,
                "days": lifetime_days,
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
        metadata={"name": name, "scopes": scopes, "lifetimeDays": lifetime_days},
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


async def list_for_workspace(session: AsyncSession, workspace_id: str) -> list[Any]:
    """Every live token in the workspace, whose it is first: the admin's list. Expired
    ones are listed too until revoked, so an admin can see a credential that lapsed."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT t.id, t.name, t.scopes, t.created_at, t.last_used_at,
                           t.expires_at, t.user_id, u.display_name AS owner_name
                      FROM mcp_tokens t
                      JOIN users u ON u.id = t.user_id
                     WHERE t.workspace_id = :ws AND t.revoked_at IS NULL
                       AND t.grant_id IS NULL
                     ORDER BY lower(u.display_name), t.created_at DESC
                    """
                ),
                {"ws": workspace_id},
            )
        ).fetchall()
    )


async def revoke_any(session: AsyncSession, admin: SessionUser, token_id: str) -> None:
    """An admin ends somebody's token. Scoped to the workspace; audited as the admin,
    naming whose it was."""
    revoked = (
        await session.execute(
            text(
                """
                UPDATE mcp_tokens SET revoked_at = now()
                 WHERE id = :id AND workspace_id = :ws AND revoked_at IS NULL
                 RETURNING id, user_id
                """
            ),
            {"id": token_id, "ws": admin.workspace_id},
        )
    ).fetchone()
    if revoked is None:
        raise not_found("There is no connection with that id.")
    await audit_service.record(
        session,
        _actor(admin),
        "mcp_token.revoked",
        target_type="mcp_token",
        target_id=token_id,
        metadata={"ownerId": str(revoked.user_id), "byAdmin": True},
    )
