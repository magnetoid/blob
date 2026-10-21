"""Signing in and out, the devices a person is signed in on, and password resets.

The SQL behind the session half of `routers/auth.py`. Sessions themselves — minting,
resolving and destroying the cookie — stay in `lib/auth.py`; this is what a route
needs around them.

A *person* here is an address, not a row. One address holds an account in each
workspace it belongs to, all behind one password (`services/workspaces`), and a session
in any of them reaches the others through the switcher without a password — so the
devices a person is signed in on, the record of what happened to their sign-in, and
"sign out everywhere else" are all the address's, across every workspace (M3 · B1).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import hash_token
from ..lib.errors import bad_request
from ..lib.ids import new_id, new_token
from . import passkeys as passkey_service
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
    out the other sessions would not have touched it. Nor is an assistant that signed in
    for its token (ADR 0029): its grant is ended too, or its refresh token would mint a
    fresh hour-long token a minute after the sign-out that was meant to stop it.
    """
    await session.execute(
        text(
            "UPDATE mcp_tokens SET revoked_at = now()"
            " WHERE user_id = :user_id AND revoked_at IS NULL"
        ),
        {"user_id": user_id},
    )
    await session.execute(
        text(
            "UPDATE oauth_grants SET revoked_at = now()"
            " WHERE user_id = :user_id AND revoked_at IS NULL"
        ),
        {"user_id": user_id},
    )


async def _revoke_connections_of_person(session: AsyncSession, email: str) -> None:
    """Every assistant this address has let in, in every workspace: pasted tokens and
    signed-in ones (their grant, so that a refresh token cannot bring them back)."""
    await session.execute(
        text(
            """
            UPDATE mcp_tokens SET revoked_at = now()
             WHERE revoked_at IS NULL
               AND user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": email},
    )
    await session.execute(
        text(
            """
            UPDATE oauth_grants SET revoked_at = now()
             WHERE revoked_at IS NULL
               AND user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": email},
    )


async def _accounts_of(session: AsyncSession, email: str) -> list[str]:
    return [
        str(row.id)
        for row in (
            await session.execute(
                text("SELECT id FROM users WHERE email = :email AND kind = 'human'"),
                {"email": email},
            )
        ).fetchall()
    ]


async def sessions_of(session: AsyncSession, email: str) -> list[Any]:
    """Every browser this person is signed in on, in every workspace, latest first."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT s.id, s.user_agent, s.ip, s.created_at, s.last_seen_at, s.method,
                           w.id AS workspace_id, w.name AS workspace_name
                      FROM sessions s
                      JOIN users u ON u.id = s.user_id
                      JOIN workspaces w ON w.id = u.workspace_id
                     WHERE u.email = :email AND u.kind = 'human' AND s.expires_at > now()
                     ORDER BY s.last_seen_at DESC
                    """
                ),
                {"email": email},
            )
        ).fetchall()
    )


async def end_session(session: AsyncSession, *, email: str, session_id: str) -> str | None:
    """Sign one of this person's browsers out. Answers the account it was signed in to,
    for the caller to close its sockets past COMMIT; None when it was not theirs."""
    ended = (
        await session.execute(
            text(
                """
                DELETE FROM sessions s USING users u
                 WHERE s.id = :id AND u.id = s.user_id AND u.email = :email
                RETURNING s.user_id
                """
            ),
            {"id": session_id, "email": email},
        )
    ).fetchone()
    return str(ended.user_id) if ended else None


async def sign_out_elsewhere(
    session: AsyncSession, *, email: str, keep_session_id: str
) -> list[str]:
    """Every session this person holds except this one, in every workspace, and every
    assistant they have let in. Answers the accounts touched, for their sockets.

    Every workspace, because a session in one reaches the others: the switcher swaps it
    for one in another workspace without asking for a password. Signing out "everywhere
    else" from one workspace used to leave a stolen session in another alive — and that
    session could switch into this one again a moment later.
    """
    await session.execute(
        text(
            """
            DELETE FROM sessions
             WHERE id <> :keep
               AND user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": email, "keep": keep_session_id},
    )
    await _revoke_connections_of_person(session, email)
    return await _accounts_of(session, email)


async def change_password(
    session: AsyncSession, *, email: str, password_hash: str, keep_session_id: str
) -> list[str]:
    """A new password for this person, chosen while signed in.

    Written to every account the address holds, like a reset (the one-password rule in
    `services/workspaces`), and every other session ends, in every workspace: whoever
    knew the old password and signed in with it is out. Assistants are left connected —
    letting one in needs a confirmed sign-in, so a stolen cookie cannot have done it,
    and they have their own list to be disconnected from. A reset is different: it is
    what somebody does who has lost control of the account, and it ends them too.
    """
    await workspace_service.set_password_everywhere(session, email, password_hash)
    await retire_resets(session, email=email)
    await session.execute(
        text(
            """
            DELETE FROM sessions
             WHERE id <> :keep
               AND user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": email, "keep": keep_session_id},
    )
    return await _accounts_of(session, email)


async def proofs_for(session: AsyncSession, email: str) -> list[str]:
    """The ways this person can prove who they are, for the confirm prompt to offer."""
    proofs = []
    if await workspace_service.password_hash_for(session, email) is not None:
        proofs.append("password")
    if await passkey_service.count_for(session, email) > 0:
        proofs.append("passkey")
    return proofs


# ─── what happened to the account ─────────────────────────────────────────────

#: How long a person's account history is kept. Long enough to notice a sign-in from a
#: holiday one did not take; short enough that it is a record, not a dossier.
EVENT_KEEP_DAYS = 90


async def record_event(
    session: AsyncSession,
    *,
    user_id: str,
    kind: str,
    method: str | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """One line of this person's account history, against the account it concerned."""
    await session.execute(
        text(
            """
            INSERT INTO account_events (id, email, user_id, kind, method, ip, user_agent)
            SELECT :id, u.email, u.id, :kind, :method, cast(:ip AS inet), :user_agent
              FROM users u WHERE u.id = :user_id
            """
        ),
        {
            "id": new_id(),
            "user_id": user_id,
            "kind": kind,
            "method": method,
            "ip": ip,
            "user_agent": (user_agent or "")[:512] or None,
        },
    )


async def events_of(session: AsyncSession, email: str, *, limit: int = 50) -> list[Any]:
    """This person's account history, newest first."""
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT e.id, e.kind, e.method, e.ip, e.user_agent, e.created_at,
                           w.name AS workspace_name
                      FROM account_events e
                      LEFT JOIN users u ON u.id = e.user_id
                      LEFT JOIN workspaces w ON w.id = u.workspace_id
                     WHERE e.email = :email
                       AND e.created_at > now() - make_interval(days => :days)
                     ORDER BY e.id DESC
                     LIMIT :limit
                    """
                ),
                {"email": email, "days": EVENT_KEEP_DAYS, "limit": limit},
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


@dataclass(slots=True, frozen=True)
class ResetClaim:
    """A reset link that has been spent, and whose password it is about to change."""

    user_id: str
    email: str


async def retire_resets(session: AsyncSession, *, email: str) -> None:
    """Every reset link still out for this address stops working.

    For when what a link would hand over has changed under it — the person was promoted,
    or their address now holds an account in another workspace — since the rules for
    who may unlock whom (`services/admin`) are checked when a link is minted, and a link
    lives an hour.
    """
    await session.execute(
        text(
            """
            UPDATE password_resets SET used_at = now()
             WHERE used_at IS NULL
               AND user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": email},
    )


async def claim_password_reset(session: AsyncSession, token: str) -> ResetClaim:
    """Spend the link — once.

    One conditional UPDATE both checks the token and marks it used, so two requests
    racing on the same link cannot both get through: the second finds `used_at` already
    set. It used to be a plain SELECT followed later by an unconditional UPDATE, and two
    clicks at the same moment both reset the password. Inside the caller's transaction,
    so if anything after this fails the claim rolls back with it and the link still works.
    """
    found = (
        await session.execute(
            text(
                """
                SELECT u.email FROM password_resets r JOIN users u ON u.id = r.user_id
                 WHERE r.token_hash = :token_hash
                """
            ),
            {"token_hash": hash_token(token)},
        )
    ).fetchone()
    if found is None:
        raise bad_request("That reset link has expired. Request a new one.")
    # One reset per address at a time. Finishing retires the address's other links, so
    # two different links finished at once used to lock each other's rows in opposite
    # orders and deadlock; taken in turn, the second finds its link already retired.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"password_reset:{found.email}"},
    )
    reset = (
        await session.execute(
            text(
                """
                UPDATE password_resets SET used_at = now()
                 WHERE token_hash = :token_hash
                   AND used_at IS NULL
                   AND expires_at > now()
                RETURNING user_id
                """
            ),
            {"token_hash": hash_token(token)},
        )
    ).fetchone()
    if reset is None:
        raise bad_request("That reset link has expired. Request a new one.")
    return ResetClaim(user_id=str(reset.user_id), email=found.email)


async def finish_password_reset(
    session: AsyncSession, claim: ResetClaim, password_hash: str
) -> tuple[str, list[str]]:
    """Set the new password everywhere this address has an account.

    Returns the user the link was minted for, and every user id that has just been
    signed out — the caller closes their sockets past COMMIT, because a connection
    authenticates once and a deleted session row does not reach it.
    """
    # Every account this address holds, not only the one the link was minted for. A
    # reset that touched one row would leave the same person locked out of their other
    # workspaces by the password they had just chosen, with nothing on screen to say
    # why. See services/workspaces for the rule this keeps.
    await workspace_service.set_password_everywhere(session, claim.email, password_hash)
    # Every other link still out there for this address dies with this one: a reset
    # requested last week, or minted by an admin, must not reset the password chosen now.
    await retire_resets(session, email=claim.email)
    # Changing a password signs out every existing session — in every workspace, since
    # the password that protected them all has just changed.
    await session.execute(
        text(
            """
            DELETE FROM sessions
             WHERE user_id IN (SELECT id FROM users WHERE email = :email)
            """
        ),
        {"email": claim.email},
    )
    # And every assistant connection, for the same reason and in the same breath. An
    # MCP token resolves to this user and reads everything they can read (ADR 0016);
    # leaving it alive through a password reset means somebody who lost control of
    # their account, reset it, and was told they had been signed out everywhere still
    # has an attacker reading their channels. That includes an assistant that signed in
    # for its token: its grant ends, or its refresh token would mint the next one.
    await _revoke_connections_of_person(session, claim.email)
    signed_out = [
        str(row.id)
        for row in (
            await session.execute(
                text("SELECT id FROM users WHERE email = :email"), {"email": claim.email}
            )
        ).fetchall()
    ]
    return claim.user_id, signed_out
