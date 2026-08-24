"""Sessions and passwords.

Sessions are opaque random tokens in an httpOnly cookie, stored server-side as a
SHA-256 digest. Chosen over JWTs because instant revocation matters more than
statelessness here: logging out a stolen laptop has to take effect now, not at expiry.

argon2-cffi verifies the PHC strings the previous @node-rs/argon2 implementation wrote,
so every existing password keeps working across the port.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Request, Response
from sqlalchemy import text

from ..config import settings
from ..db.engine import SessionFactory
from .errors import forbidden, unauthorized
from .ids import new_id, new_token

SESSION_COOKIE = "blob_session"

_hasher = PasswordHasher()

Role = Literal["member", "admin", "owner"]


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def hash_password(plain: str) -> str:
    # Argon2 is deliberately slow; keep it off the event loop.
    return await asyncio.to_thread(_hasher.hash, plain)


async def verify_password(hash_value: str, plain: str) -> bool:
    def _verify() -> bool:
        try:
            return _hasher.verify(hash_value, plain)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False

    return await asyncio.to_thread(_verify)


@dataclass(slots=True)
class SessionUser:
    id: str
    workspace_id: str
    email: str
    display_name: str
    role: Role
    session_id: str

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "owner")


async def create_session(user_id: str, user_agent: str | None, ip: str | None) -> str:
    token = new_token()
    expires_at = datetime.now(UTC) + timedelta(days=settings.SESSION_TTL_DAYS)
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO sessions (id, user_id, token_hash, user_agent, ip, expires_at)
                    VALUES (:id, :user_id, :token_hash, :user_agent, cast(:ip AS inet), :expires_at)
                    """
                ),
                {
                    "id": new_id(),
                    "user_id": user_id,
                    "token_hash": hash_token(token),
                    "user_agent": user_agent,
                    "ip": ip,
                    "expires_at": expires_at,
                },
            )
    return token


async def resolve_session(token: str) -> SessionUser | None:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT s.id AS session_id, u.id, u.workspace_id, u.email,
                           u.display_name, u.role
                      FROM sessions s
                      JOIN users u ON u.id = s.user_id
                     WHERE s.token_hash = :token_hash
                       AND s.expires_at > now()
                       AND u.deactivated_at IS NULL
                    """
                ),
                {"token_hash": hash_token(token)},
            )
        ).fetchone()

        if row is None:
            return None

        # Touch last_seen_at at most once a minute; this runs on every request, and the
        # WHERE clause means it usually matches no rows.
        await session.execute(
            text(
                """
                UPDATE sessions SET last_seen_at = now()
                 WHERE id = :id AND last_seen_at < now() - interval '1 minute'
                """
            ),
            {"id": row.session_id},
        )
        await session.commit()

        return SessionUser(
            id=row.id,
            workspace_id=row.workspace_id,
            email=row.email,
            display_name=row.display_name,
            role=row.role,
            session_id=row.session_id,
        )


async def destroy_session(session_id: str) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(text("DELETE FROM sessions WHERE id = :id"), {"id": session_id})


async def destroy_other_sessions(user_id: str, keep_session_id: str | None = None) -> None:
    """Sign out everywhere, optionally keeping the session making the request."""
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                text(
                    """
                    DELETE FROM sessions
                     WHERE user_id = :user_id
                       AND (cast(:keep AS uuid) IS NULL OR id <> cast(:keep AS uuid))
                    """
                ),
                {"user_id": user_id, "keep": keep_session_id},
            )


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.is_prod,
        path="/",
        max_age=settings.SESSION_TTL_DAYS * 86_400,
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def current_user(request: Request) -> SessionUser:
    """The signed-in user, or 401."""
    user: SessionUser | None = getattr(request.state, "user", None)
    if user is None:
        raise unauthorized()
    return user


def require_admin(request: Request) -> SessionUser:
    """Admin or owner, else 403.

    Deliberately 403 rather than the 401 the TypeScript server returned: the client
    treats 401 as "signed out" and would bounce an admin to the login screen.
    """
    user = current_user(request)
    if not user.is_admin:
        raise forbidden("You need admin access for that.")
    return user


def require_owner(request: Request) -> SessionUser:
    user = current_user(request)
    if user.role != "owner":
        raise forbidden("Only the workspace owner can do that.")
    return user


async def require_instance_admin(request: Request) -> SessionUser:
    """Administers the server, not a workspace on it.

    Async and a database read, unlike the other two: `role` lives on the user row and is
    scoped to one workspace, while this is a fact about a person across all of them. It
    cannot be answered from the session alone, and pretending otherwise is what made
    `owner` stand in for it for as long as there was only one workspace to own.
    """
    user = current_user(request)
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text("SELECT 1 FROM instance_admins WHERE email = :email"),
                {"email": user.email},
            )
        ).fetchone()
    if row is None:
        raise forbidden("Only a server administrator can do that.")
    return user
