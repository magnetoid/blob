"""Signup, login, invites, password reset.

Shape and authorize. `services/signup.py` holds founding, joining and invitations;
`services/accounts.py` holds sign-in, devices and password resets. What stays here is
the cookie — minted and cleared on the response — the rate limits, the mail that goes
out after COMMIT, and the sockets closed past it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import mail
from ..lib.auth import (
    SessionUser,
    clear_session_cookie,
    create_session,
    current_user,
    destroy_other_sessions,
    destroy_session,
    hash_password,
    require_admin,
    set_session_cookie,
    verify_password,
)
from ..lib.caller import client_ip, client_key
from ..lib.errors import unauthorized
from ..lib.mail import send_invite, send_password_reset
from ..lib.rate_limit import consume
from ..realtime import hub
from ..schemas.base import CamelModel, OkOut, iso
from ..schemas.models import CurrentUser
from ..schemas.requests import (
    CreateInviteInput,
    ForgotPasswordInput,
    LoginInput,
    ResetPasswordInput,
    SignupInput,
)
from ..services import accounts as account_service
from ..services import signup as signup_service
from ..services.audit import actor_for
from ..services.serialize import to_current_user

router = APIRouter(tags=["auth"])


class AuthStateOut(CamelModel):
    needs_setup: bool


class SessionOut(CamelModel):
    user: CurrentUser


class ForgotOut(CamelModel):
    ok: bool = True
    #: Whether mail leaves this server at all. Nothing about the address that was typed.
    mail_reachable: bool = True


class InviteOut(CamelModel):
    url: str
    expires_at: str
    #: Whether the invitation actually reached them by email. None when no address was
    #: given (a shareable link is not emailed to anybody). False means the link on
    #: screen is the only copy that exists — somebody has to send it.
    emailed: bool | None = None


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


async def _sign_in(request: Request, response: Response, user_id: str) -> None:
    token = await create_session(user_id, request.headers.get("user-agent"), client_ip(request))
    set_session_cookie(response, token)


@router.get("/api/auth/state", response_model=AuthStateOut)
async def auth_state() -> AuthStateOut:
    """Is this a fresh install? The first person to sign up founds the workspace."""
    async with session_scope() as session:
        return AuthStateOut(needs_setup=await signup_service.needs_setup(session))


@router.post("/api/auth/signup", response_model=SessionOut)
async def signup(payload: SignupInput, request: Request, response: Response) -> SessionOut:
    await consume("signup", client_key(request))
    async with transaction() as (session, _):
        user_id, user = await signup_service.signup(
            session,
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
            workspace_name=payload.workspace_name,
            invite_token=payload.invite_token,
        )
    await _sign_in(request, response, user_id)
    return SessionOut(user=user)


@router.post("/api/auth/login", response_model=SessionOut)
async def login(payload: LoginInput, request: Request, response: Response) -> SessionOut:
    await consume("login", client_key(request))
    async with session_scope() as session:
        row = await account_service.find_for_login(session, payload.email)

    # Same message either way — never reveal whether an address is registered.
    invalid = unauthorized("That email or password is incorrect.")
    if row is None or not row.password_hash:
        raise invalid
    if row.deactivated_at is not None:
        raise unauthorized("That account has been deactivated.")
    if not await verify_password(row.password_hash, payload.password):
        raise invalid

    await _sign_in(request, response, row.id)
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
    async with transaction() as (session, _after):
        await account_service.revoke_assistant_tokens(session, user.id)
    # Deleting the session rows stops the *next* request; it does not stop a socket
    # that authenticated once at connect and never asks again. Without this, "sign out
    # everywhere else" left every other tab — including a stolen one — receiving every
    # message in real time for as long as it kept pinging.
    #
    # A connection carries no session id, so this drops the caller's socket too. That
    # costs a reconnect: the client's existing backoff-and-resync path runs and the
    # surviving session authenticates again.
    hub.close_users([user.id])
    return OkOut()


@router.get("/api/auth/sessions", response_model=SessionsOut)
async def list_sessions(user: SessionUser = Depends(current_user)) -> SessionsOut:
    async with session_scope() as session:
        rows = await account_service.sessions_for(session, user.id)
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
    async with transaction() as (session, _):
        token, expires_at, workspace_name = await signup_service.create_invite(
            session,
            actor_for(request, user),
            email=payload.email,
            role=payload.role,
            expires_in_days=payload.expires_in_days,
        )

    url = f"{settings.PUBLIC_URL}/join/{token}"
    emailed: bool | None = None
    if payload.email:
        emailed = await send_invite(payload.email, user.display_name, url, workspace_name)
    return InviteOut(url=url, expires_at=expires_at, emailed=emailed)


@router.get("/api/invites/{token}", response_model=InvitePreviewOut)
async def preview_invite(token: str) -> InvitePreviewOut:
    async with session_scope() as session:
        email, workspace = await signup_service.preview_invite(session, token)
    return InvitePreviewOut(email=email, workspace=workspace)


# ─── password reset ───────────────────────────────────────────────────────────
@router.post("/api/auth/forgot-password", response_model=ForgotOut)
async def forgot_password(payload: ForgotPasswordInput, request: Request) -> ForgotOut:
    await consume("password_reset", client_key(request))
    async with transaction() as (session, _):
        token = await account_service.begin_password_reset(session, payload.email)
    if token:
        await send_password_reset(payload.email, f"{settings.PUBLIC_URL}/reset/{token}")
    # Always the same answer about the *account* — otherwise this endpoint enumerates
    # them. What can be said without leaking anything is whether this server can send
    # email at all, which is about the server and is asked the same way either way: a
    # screen that promises a link while SMTP is refusing connections is the one outright
    # lie in the app.
    return ForgotOut(mail_reachable=await mail.probe() == "ok")


@router.post("/api/auth/reset-password", response_model=OkOut)
async def reset_password(
    payload: ResetPasswordInput, request: Request, response: Response
) -> OkOut:
    async with transaction() as (session, after):
        user_id, signed_out = await account_service.finish_password_reset(
            session, payload.token, await hash_password(payload.password)
        )
        # The sockets those sessions are holding, past COMMIT: a connection
        # authenticates once, so a socket opened with a since-deleted session keeps
        # delivering until the tab is closed.
        after.add(lambda: hub.close_users(signed_out))
    await _sign_in(request, response, user_id)
    return OkOut()


__all__ = ["router"]
