"""Signing in and out, the devices a person is signed in on, and password resets.

The SQL behind the session half of `routers/auth.py`. Sessions themselves — minting,
resolving and destroying the cookie — stay in `lib/auth.py`; this is what a route
needs around them.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import hash_token
from ..lib.errors import bad_request
from ..lib.ids import new_id, new_token
from . import workspaces as workspace_service
from .serialize import USER_COLUMNS


async def find_for_login(session: AsyncSession, email: str) -> Any:
    """The account a bare sign-in lands in.

    One address can hold an account in several workspaces, so this has to say *which*
    one rather than take whatever the planner returns first. Live accounts win, then
    oldest — the same order `workspaces.for_email` lists them in, so where a bare
    sign-in lands and what the switcher shows first agree. When every account is
    deactivated a deactivated row is still selected, which is what keeps the
    "deactivated" message reachable.
    """
    return (
        await session.execute(
            text(
                f"""
                SELECT {USER_COLUMNS}, password_hash FROM users
                 WHERE email = :email AND kind = 'human'
                 ORDER BY (deactivated_at IS NULL) DESC, created_at
                 LIMIT 1
                """
            ),
            {"email": email.lower()},
        )
    ).fetchone()


async def revoke_assistant_tokens(session: AsyncSession, user_id: str) -> None:
    """ "Everywhere else" has to mean everywhere else.

    An assistant holding an MCP token is a session in every sense that matters — it
    reads what this person reads — and it is not in the `sessions` table, so signing
    out the other sessions would not have touched it.
    """
    await session.execute(
        text(
            "UPDATE mcp_tokens SET revoked_at = now()"
            " WHERE user_id = :user_id AND revoked_at IS NULL"
        ),
        {"user_id": user_id},
    )


async def sessions_for(session: AsyncSession, user_id: str) -> list[Any]:
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT id, user_agent, ip, created_at, last_seen_at
                      FROM sessions WHERE user_id = :user_id ORDER BY last_seen_at DESC
                    """
                ),
                {"user_id": user_id},
            )
        ).fetchall()
    )


# ─── password reset ───────────────────────────────────────────────────────────


async def begin_password_reset(session: AsyncSession, email: str) -> str | None:
    """Mint a reset token for this address, or nothing when no live account holds it.

    The caller answers the same way either way: this endpoint must not enumerate
    accounts, and whether a token exists is for the mail to say.
    """
    user = (
        await session.execute(
            text(
                """
                SELECT id FROM users
                 WHERE email = :email AND deactivated_at IS NULL AND kind = 'human'
                 ORDER BY created_at
                 LIMIT 1
                """
            ),
            {"email": email.lower()},
        )
    ).fetchone()
    if user is None:
        return None
    token = new_token()
    await session.execute(
        text(
            """
            INSERT INTO password_resets (id, user_id, token_hash, expires_at)
            VALUES (:id, :user_id, :token_hash, now() + interval '1 hour')
            """
        ),
        {"id": new_id(), "user_id": user.id, "token_hash": hash_token(token)},
    )
    return token


async def finish_password_reset(
    session: AsyncSession, token: str, password_hash: str
) -> tuple[str, list[str]]:
    """Set the new password everywhere this address has an account.

    Returns the user the link was minted for, and every user id that has just been
    signed out — the caller closes their sockets past COMMIT, because a connection
    authenticates once and a deleted session row does not reach it.
    """
    reset = (
        await session.execute(
            text(
                """
                SELECT id, user_id FROM password_resets
                 WHERE token_hash = :token_hash
                   AND used_at IS NULL
                   AND expires_at > now()
                """
            ),
            {"token_hash": hash_token(token)},
        )
    ).fetchone()
    if reset is None:
        raise bad_request("That reset link has expired. Request a new one.")

    # Every account this address holds, not only the one the link was minted for. A
    # reset that touched one row would leave the same person locked out of their other
    # workspaces by the password they had just chosen, with nothing on screen to say
    # why. See services/workspaces for the rule this keeps.
    owner = (
        await session.execute(text("SELECT email FROM users WHERE id = :id"), {"id": reset.user_id})
    ).fetchone()
    if owner is None:
        raise bad_request("That reset link is no longer valid.")
    await workspace_service.set_password_everywhere(session, owner.email, password_hash)
    await session.execute(
        text("UPDATE password_resets SET used_at = now() WHERE id = :id"), {"id": reset.id}
    )
    # Changing a password signs out every existing session — in every workspace, since
    # the password that protected them all has just changed.
    await session.execute(
        text(
            """
            DELETE FROM sessions
             WHERE user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": owner.email},
    )
    # And every assistant connection, for the same reason and in the same breath. An
    # MCP token resolves to this user and reads everything they can read (ADR 0016);
    # leaving it alive through a password reset means somebody who lost control of
    # their account, reset it, and was told they had been signed out everywhere still
    # has an attacker reading their channels.
    await session.execute(
        text(
            """
            UPDATE mcp_tokens SET revoked_at = now()
             WHERE revoked_at IS NULL
               AND user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": owner.email},
    )
    signed_out = [
        str(row.id)
        for row in (
            await session.execute(
                text("SELECT id FROM users WHERE email = :email"), {"email": owner.email}
            )
        ).fetchall()
    ]
    return str(reset.user_id), signed_out
