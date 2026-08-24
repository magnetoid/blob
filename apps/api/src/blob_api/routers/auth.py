"""Signup, login, invites, password reset."""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import (
    SessionUser,
    clear_session_cookie,
    create_session,
    current_user,
    destroy_other_sessions,
    destroy_session,
    hash_password,
    hash_token,
    require_admin,
    set_session_cookie,
    verify_password,
)
from ..lib.errors import bad_request, conflict, not_found, unauthorized, unique_violation
from ..lib.ids import new_id, new_token
from ..lib.mail import send_invite, send_password_reset
from ..lib.rate_limit import consume
from ..schemas.base import CamelModel, iso
from ..schemas.models import CurrentUser
from ..schemas.requests import (
    CreateInviteInput,
    ForgotPasswordInput,
    LoginInput,
    ResetPasswordInput,
    SignupInput,
)
from ..services import audit as audit_service
from ..services import workspaces as workspace_service
from ..services.audit import actor_for
from ..services.channels import DEFAULT_CHANNELS, add_members
from ..services.serialize import USER_COLUMNS, to_current_user

router = APIRouter(tags=["auth"])


class AuthStateOut(CamelModel):
    needs_setup: bool


class SessionOut(CamelModel):
    user: CurrentUser


class OkOut(CamelModel):
    ok: bool = True


class InviteOut(CamelModel):
    url: str
    expires_at: str


class InvitePreviewOut(CamelModel):
    email: str | None
    workspace: str


class SessionRow(CamelModel):
    id: str
    current: bool
    user_agent: str | None
    ip: str | None
    created_at: str
    last_seen_at: str


class SessionsOut(CamelModel):
    sessions: list[SessionRow]


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
    return slug or "workspace"


@router.get("/api/auth/state", response_model=AuthStateOut)
async def auth_state() -> AuthStateOut:
    """Is this a fresh install? The first person to sign up founds the workspace."""
    async with session_scope() as session:
        row = (await session.execute(text("SELECT count(*) AS count FROM workspaces"))).fetchone()
    return AuthStateOut(needs_setup=(row.count if row else 0) == 0)


@router.post("/api/auth/signup", response_model=SessionOut)
async def signup(payload: SignupInput, request: Request, response: Response) -> SessionOut:
    await consume("signup", request.client.host if request.client else "unknown")
    email = payload.email.lower()

    async with transaction() as (session, _):
        # Only "is this a fresh install?" — *which* workspace someone joins comes from
        # their invitation, never from this row. Reading the workspace here and using it
        # for the join was correct while there was one; with two it silently put people
        # into the oldest one whatever they had been invited to.
        workspace = (
            await session.execute(text("SELECT id FROM workspaces ORDER BY created_at LIMIT 1"))
        ).fetchone()

        role = "member"
        user_id = ""
        if workspace is None:
            # First ever signup founds the workspace, through the one path that makes
            # one — see services/workspaces.found, which also seeds its default channels.
            # Its founder becomes the server's first instance admin: there is nobody else
            # to be, and a server whose instance console nobody can open has no way back.
            try:
                founded = await workspace_service.found(
                    session,
                    name=(payload.workspace_name or "").strip() or "Workspace",
                    email=email,
                    display_name=payload.display_name,
                    password_hash=await hash_password(payload.password),
                    grant_admin=True,
                )
            except Exception as exc:
                if unique_violation(exc):
                    raise conflict(
                        "That email or display name is already taken.", "user_exists"
                    ) from exc
                raise
            workspace_id = founded.workspace_id
            user_id = founded.owner_user_id
        else:
            if not payload.invite_token:
                raise unauthorized("You need an invitation to join.")

            invite = (
                await session.execute(
                    text(
                        """
                        SELECT id, email, role, workspace_id FROM invites
                         WHERE token_hash = :token_hash
                           AND accepted_at IS NULL
                           AND expires_at > now()
                        """
                    ),
                    {"token_hash": hash_token(payload.invite_token)},
                )
            ).fetchone()
            if invite is None:
                raise unauthorized("That invitation has expired or was already used.")
            if invite.email and invite.email.lower() != email:
                raise bad_request("That invitation was issued for a different email address.")
            role = getattr(invite, "role", None) or "member"
            # The invitation says which workspace. It always did; nothing read it.
            workspace_id = invite.workspace_id

        if workspace is not None:
            user_id = new_id()
            try:
                await session.execute(
                    text(
                        """
                        INSERT INTO users
                          (id, workspace_id, email, password_hash, display_name, role)
                        VALUES (:id, :ws, :email, :password_hash, :display_name, :role)
                        """
                    ),
                    {
                        "id": user_id,
                        "ws": workspace_id,
                        "email": email,
                        "password_hash": await hash_password(payload.password),
                        "display_name": payload.display_name,
                        "role": role,
                    },
                )
            except Exception as exc:
                if unique_violation(exc):
                    raise conflict(
                        "That email or display name is already taken.", "user_exists"
                    ) from exc
                raise

            defaults = (
                await session.execute(
                    text(
                        """
                        SELECT id FROM channels
                         WHERE workspace_id = :ws AND kind = 'public'
                           AND name = ANY(cast(:names AS text[]))
                        """
                    ),
                    {"ws": workspace_id, "names": list(DEFAULT_CHANNELS)},
                )
            ).fetchall()
            for row in defaults:
                await add_members(session, channel_id=row.id, user_ids=[user_id])

            await session.execute(
                text(
                    """
                    UPDATE invites SET accepted_at = now(), accepted_by = :user_id
                     WHERE token_hash = :token_hash
                    """
                ),
                {"user_id": user_id, "token_hash": hash_token(payload.invite_token or "")},
            )

        created = (
            await session.execute(
                text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
            )
        ).fetchone()
        if created is None:
            raise bad_request("Could not create that account.")
        user = to_current_user(created)

    token = await create_session(
        user_id,
        request.headers.get("user-agent"),
        request.client.host if request.client else None,
    )
    set_session_cookie(response, token)
    return SessionOut(user=user)


@router.post("/api/auth/login", response_model=SessionOut)
async def login(payload: LoginInput, request: Request, response: Response) -> SessionOut:
    await consume("login", request.client.host if request.client else "unknown")

    async with session_scope() as session:
        # One address can hold an account in several workspaces, so this has to say
        # *which* one rather than take whatever the planner returns first. Live accounts
        # win, then oldest — the same order `workspaces.for_email` lists them in, so
        # where a bare sign-in lands and what the switcher shows first agree. When every
        # account is deactivated a deactivated row is still selected, which is what keeps
        # the "deactivated" message below reachable.
        row = (
            await session.execute(
                text(
                    f"""
                    SELECT {USER_COLUMNS}, password_hash FROM users
                     WHERE email = :email AND kind = 'human'
                     ORDER BY (deactivated_at IS NULL) DESC, created_at
                     LIMIT 1
                    """
                ),
                {"email": payload.email.lower()},
            )
        ).fetchone()

    # Same message either way — never reveal whether an address is registered.
    invalid = unauthorized("That email or password is incorrect.")
    if row is None or not row.password_hash:
        raise invalid
    if row.deactivated_at is not None:
        raise unauthorized("That account has been deactivated.")
    if not await verify_password(row.password_hash, payload.password):
        raise invalid

    token = await create_session(
        row.id,
        request.headers.get("user-agent"),
        request.client.host if request.client else None,
    )
    set_session_cookie(response, token)
    return SessionOut(user=to_current_user(row))


@router.post("/api/auth/logout", response_model=OkOut)
async def logout(request: Request, response: Response) -> OkOut:
    user: SessionUser | None = getattr(request.state, "user", None)
    if user is not None:
        await destroy_session(user.session_id)
    clear_session_cookie(response)
    return OkOut()


@router.post("/api/auth/logout-others", response_model=OkOut)
async def logout_others(user: SessionUser = Depends(current_user)) -> OkOut:
    await destroy_other_sessions(user.id, user.session_id)
    return OkOut()


@router.get("/api/auth/sessions", response_model=SessionsOut)
async def list_sessions(user: SessionUser = Depends(current_user)) -> SessionsOut:
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, user_agent, ip, created_at, last_seen_at
                      FROM sessions WHERE user_id = :user_id ORDER BY last_seen_at DESC
                    """
                ),
                {"user_id": user.id},
            )
        ).fetchall()

    return SessionsOut(
        sessions=[
            SessionRow(
                id=row.id,
                current=row.id == user.session_id,
                user_agent=row.user_agent,
                ip=str(row.ip) if row.ip else None,
                created_at=iso(row.created_at) or "",
                last_seen_at=iso(row.last_seen_at) or "",
            )
            for row in rows
        ]
    )


# ─── invitations ──────────────────────────────────────────────────────────────
@router.post("/api/invites", response_model=InviteOut)
async def create_invite(
    request: Request,
    payload: CreateInviteInput | None = None,
    user: SessionUser = Depends(require_admin),
) -> InviteOut:
    payload = payload or CreateInviteInput()
    await consume("invite", user.id)

    token = new_token()
    invite_id = new_id()
    async with transaction() as (session, _):
        row = (
            await session.execute(
                text(
                    """
                    INSERT INTO invites
                      (id, workspace_id, email, token_hash, created_by, expires_at, role)
                    VALUES (:id, :ws, :email, :token_hash, :created_by,
                            now() + make_interval(days => :days), :role)
                    RETURNING expires_at
                    """
                ),
                {
                    "id": invite_id,
                    "ws": user.workspace_id,
                    "email": payload.email.lower() if payload.email else None,
                    "token_hash": hash_token(token),
                    "created_by": user.id,
                    "days": payload.expires_in_days,
                    "role": payload.role,
                },
            )
        ).fetchone()
        # Minting a way into the workspace — and an admin-role invitation is a way to
        # mint an admin. The revocation was already logged; the creation was not.
        await audit_service.record(
            session,
            actor_for(request, user),
            "invite.created",
            target_type="invite",
            target_id=invite_id,
            metadata={"email": payload.email, "role": payload.role},
        )
        workspace = (
            await session.execute(
                text("SELECT name FROM workspaces WHERE id = :id"), {"id": user.workspace_id}
            )
        ).fetchone()

    if row is None:
        raise bad_request("Could not create that invitation.")

    url = f"{settings.PUBLIC_URL}/join/{token}"
    if payload.email:
        await send_invite(
            payload.email, user.display_name, url, workspace.name if workspace else "the workspace"
        )
    return InviteOut(url=url, expires_at=iso(row.expires_at) or "")


@router.get("/api/invites/{token}", response_model=InvitePreviewOut)
async def preview_invite(token: str) -> InvitePreviewOut:
    async with session_scope() as session:
        invite = (
            await session.execute(
                text(
                    """
                    SELECT i.email, w.name AS workspace
                      FROM invites i JOIN workspaces w ON w.id = i.workspace_id
                     WHERE i.token_hash = :token_hash
                       AND i.accepted_at IS NULL
                       AND i.expires_at > now()
                    """
                ),
                {"token_hash": hash_token(token)},
            )
        ).fetchone()
    if invite is None:
        raise not_found("That invitation has expired or was already used.")
    return InvitePreviewOut(email=invite.email, workspace=invite.workspace)


# ─── password reset ───────────────────────────────────────────────────────────
@router.post("/api/auth/forgot-password", response_model=OkOut)
async def forgot_password(payload: ForgotPasswordInput, request: Request) -> OkOut:
    await consume("password_reset", request.client.host if request.client else "unknown")

    async with transaction() as (session, _):
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
                {"email": payload.email.lower()},
            )
        ).fetchone()
        token: str | None = None
        if user is not None:
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

    # Always report success — otherwise this endpoint enumerates accounts.
    if token:
        await send_password_reset(payload.email, f"{settings.PUBLIC_URL}/reset/{token}")
    return OkOut()


@router.post("/api/auth/reset-password", response_model=OkOut)
async def reset_password(
    payload: ResetPasswordInput, request: Request, response: Response
) -> OkOut:
    async with transaction() as (session, _):
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
                {"token_hash": hash_token(payload.token)},
            )
        ).fetchone()
        if reset is None:
            raise bad_request("That reset link has expired. Request a new one.")

        # Every account this address holds, not only the one the link was minted for.
        # A reset that touched one row would leave the same person locked out of their
        # other workspaces by the password they had just chosen, with nothing on screen
        # to say why. See services/workspaces for the rule this keeps.
        owner = (
            await session.execute(
                text("SELECT email FROM users WHERE id = :id"), {"id": reset.user_id}
            )
        ).fetchone()
        if owner is None:
            raise bad_request("That reset link is no longer valid.")
        await workspace_service.set_password_everywhere(
            session, owner.email, await hash_password(payload.password)
        )
        await session.execute(
            text("UPDATE password_resets SET used_at = now() WHERE id = :id"), {"id": reset.id}
        )
        # Changing a password signs out every existing session — in every workspace,
        # since the password that protected them all has just changed.
        await session.execute(
            text(
                """
                DELETE FROM sessions
                 WHERE user_id IN (SELECT id FROM users WHERE email = :email)
                """
            ),
            {"email": owner.email},
        )
        user_id = reset.user_id

    token = await create_session(
        user_id,
        request.headers.get("user-agent"),
        request.client.host if request.client else None,
    )
    set_session_cookie(response, token)
    return OkOut()


__all__ = ["router"]
