"""Signup, login, invites, password reset, and a person's own sign-in security.

Shape and authorize. `services/signup.py` holds founding, joining and invitations;
`services/accounts.py` holds sign-in, devices, account history and password resets. What
stays here is the cookie — minted and cleared on the response — the rate limits, the
mail that goes out after COMMIT, and the sockets closed past it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, Response

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import mail
from ..lib.auth import (
    REAUTH_WINDOW,
    SessionUser,
    assert_recent_auth,
    clear_session_cookie,
    create_session,
    current_user,
    destroy_session,
    hash_password,
    mark_proven,
    require_admin,
    set_session_cookie,
    verify_password,
)
from ..lib.caller import client_ip, client_key
from ..lib.errors import AppError, forbidden, not_found, unauthorized
from ..lib.ids import IdParam
from ..lib.mail import send_invite, send_password_reset
from ..lib.rate_limit import consume
from ..realtime import hub
from ..schemas.base import CamelModel, OkOut, iso
from ..schemas.models import CurrentUser
from ..schemas.requests import (
    ChangePasswordInput,
    CreateInviteInput,
    ForgotPasswordInput,
    LoginInput,
    ReauthInput,
    ResetPasswordInput,
    SignupInput,
)
from ..services import accounts as account_service
from ..services import passkeys as passkey_service
from ..services import signup as signup_service
from ..services import sso as sso_service
from ..services import workspaces as workspace_service
from ..services.audit import actor_for
from ..services.serialize import to_current_user

router = APIRouter(tags=["auth"])


class SsoChoiceOut(CamelModel):
    slug: str
    name: str


class AuthStateOut(CamelModel):
    needs_setup: bool
    #: Single sign-on buttons for the sign-in page (ADR 0033).
    providers: list[SsoChoiceOut] = []


class SessionOut(CamelModel):
    user: CurrentUser


class PasskeyChallengeOut(CamelModel):
    #: Spends the challenge: sent back with the browser's answer.
    flow_id: str
    #: As `PublicKeyCredential.parseRequestOptionsFromJSON` takes them.
    options: dict[str, Any]


class LoginOut(CamelModel):
    user: CurrentUser | None = None
    #: Instead of `user`, when the password was right and this person asks for a passkey
    #: as well (ADR 0032): the browser answers it at `POST /api/auth/two-step`.
    two_step: PasskeyChallengeOut | None = None


class ResetOut(CamelModel):
    ok: bool = True
    #: False when the person asks for a passkey after their password: a reset proves the
    #: inbox, not the passkey, so they sign in with both once it is done.
    signed_in: bool = True


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
    #: How that browser signed in; None for sessions older than the column.
    method: str | None = None
    #: Which of this person's workspaces the session is in — sessions are listed across
    #: all of them, since any one reaches the rest through the switcher.
    workspace_id: str | None = None
    workspace: str | None = None


class SessionsOut(CamelModel):
    sessions: list[SessionRow]


class AccountEventRow(CamelModel):
    id: str
    kind: str
    method: str | None
    ip: str | None
    user_agent: str | None
    workspace: str | None
    created_at: str


class AccountActivityOut(CamelModel):
    events: list[AccountEventRow]
    #: How many days back the record goes.
    keep_days: int


class ReauthStateOut(CamelModel):
    #: The ways this person can confirm it is them, for the prompt to offer.
    methods: list[str]
    #: The single sign-on providers linked to them, each a way to confirm.
    providers: list[SsoChoiceOut] = []
    #: When this session last proved it, if within the window.
    proven_at: str | None
    window_minutes: int


async def start_session(request: Request, response: Response, user_id: str, *, method: str) -> None:
    """Mint the session, set the cookie, and write the line in the person's history."""
    user_agent = request.headers.get("user-agent")
    ip = client_ip(request)
    token = await create_session(
        user_id, user_agent, ip, method=method, proven_at=datetime.now(UTC)
    )
    set_session_cookie(response, token)
    async with transaction() as (session, _):
        await account_service.record_event(
            session,
            user_id=user_id,
            kind="signed_in",
            method=method,
            ip=ip,
            user_agent=user_agent,
        )


async def note(request: Request, user_id: str, kind: str, method: str | None = None) -> None:
    """One line of the person's record, from this request's device and address."""
    async with transaction() as (session, _):
        await account_service.record_event(
            session,
            user_id=user_id,
            kind=kind,
            method=method,
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )


def _wrong_password() -> AppError:
    # 400 rather than 401: the person is signed in, and the client reads 401 as "signed
    # out" and would bounce them to the sign-in screen for a typo.
    return AppError(400, "wrong_password", "That password is incorrect.", field="password")


@router.get("/api/auth/state", response_model=AuthStateOut)
async def auth_state() -> AuthStateOut:
    """Is this a fresh install? The first person to sign up founds the workspace."""
    async with session_scope() as session:
        providers = await sso_service.enabled_providers(session)
        return AuthStateOut(
            needs_setup=await signup_service.needs_setup(session),
            providers=[SsoChoiceOut(slug=p.slug, name=p.name) for p in providers],
        )


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
    await start_session(request, response, user_id, method="signup")
    return SessionOut(user=user)


@router.post("/api/auth/login", response_model=LoginOut)
async def login(payload: LoginInput, request: Request, response: Response) -> LoginOut:
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
        # On the person's own record, where they will see it: a run of these is how
        # somebody learns their address is being tried.
        await note(request, row.id, "failed", "password")
        raise invalid

    async with session_scope() as session:
        if await passkey_service.two_step_required(session, row.email):
            # Half a sign-in: no session until one of their passkeys answers.
            flow_id, options = await passkey_service.begin_authentication(
                session, purpose="two_step", email=row.email, user_id=str(row.id)
            )
            return LoginOut(two_step=PasskeyChallengeOut(flow_id=flow_id, options=options))
    await start_session(request, response, row.id, method="password")
    async with session_scope() as session:
        instance_admin = await workspace_service.is_instance_admin(session, row.email)
    return LoginOut(user=to_current_user(row, is_instance_admin=instance_admin))


@router.post("/api/auth/logout", response_model=OkOut)
async def logout(request: Request, response: Response) -> OkOut:
    user: SessionUser | None = getattr(request.state, "user", None)
    if user is not None:
        await destroy_session(user.session_id)
    clear_session_cookie(response)
    return OkOut()


@router.post("/api/auth/logout-others", response_model=OkOut)
async def logout_others(request: Request, user: SessionUser = Depends(current_user)) -> OkOut:
    """Every other browser this person is signed in on, in every workspace, and every
    assistant they have let in (`accounts.sign_out_elsewhere` says why every workspace)."""
    async with transaction() as (session, after):
        signed_out = await account_service.sign_out_elsewhere(
            session, email=user.email, keep_session_id=user.session_id
        )
        await account_service.record_event(
            session,
            user_id=user.id,
            kind="signed_out_elsewhere",
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        # Deleting the session rows stops the *next* request; it does not stop a socket
        # that authenticated once at connect and never asks again. Without this, "sign
        # out everywhere else" left every other tab — including a stolen one — receiving
        # every message in real time for as long as it kept pinging.
        #
        # A connection carries no session id, so this drops the caller's socket too.
        # That costs a reconnect: the client's existing backoff-and-resync path runs and
        # the surviving session authenticates again.
        after.add(lambda: hub.close_users(signed_out))
    return OkOut()


@router.get("/api/auth/sessions", response_model=SessionsOut)
async def list_sessions(user: SessionUser = Depends(current_user)) -> SessionsOut:
    async with session_scope() as session:
        rows = await account_service.sessions_of(session, user.email)
    return SessionsOut(
        sessions=[
            SessionRow(
                id=row.id,
                current=row.id == user.session_id,
                user_agent=row.user_agent,
                ip=str(row.ip) if row.ip else None,
                created_at=iso(row.created_at) or "",
                last_seen_at=iso(row.last_seen_at) or "",
                method=row.method,
                workspace_id=str(row.workspace_id),
                workspace=row.workspace_name,
            )
            for row in rows
        ]
    )


@router.delete("/api/auth/sessions/{session_id}", response_model=OkOut)
async def end_session(
    session_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Sign one browser out — one the person no longer has, or does not recognise."""
    async with transaction() as (session, after):
        ended = await account_service.end_session(session, email=user.email, session_id=session_id)
        if ended is None:
            raise not_found("That session has already ended.")
        await account_service.record_event(
            session,
            user_id=ended,
            kind="session_ended",
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        # Its sockets carry no session id, so every socket of that account drops and
        # the ones still signed in reconnect — the cost `logout-others` already pays.
        after.add(lambda: hub.close_users([ended]))
    return OkOut()


@router.get("/api/auth/activity", response_model=AccountActivityOut)
async def account_activity(user: SessionUser = Depends(current_user)) -> AccountActivityOut:
    """What has happened to this person's sign-in lately, in every workspace."""
    async with session_scope() as session:
        rows = await account_service.events_of(session, user.email)
    return AccountActivityOut(
        events=[
            AccountEventRow(
                id=row.id,
                kind=row.kind,
                method=row.method,
                ip=str(row.ip) if row.ip else None,
                user_agent=row.user_agent,
                workspace=row.workspace_name,
                created_at=iso(row.created_at) or "",
            )
            for row in rows
        ],
        keep_days=account_service.EVENT_KEEP_DAYS,
    )


# ─── confirming it is you ─────────────────────────────────────────────────────


@router.get("/api/auth/reauth", response_model=ReauthStateOut)
async def reauth_state(user: SessionUser = Depends(current_user)) -> ReauthStateOut:
    """What the confirm prompt may offer, and whether this session needs it at all."""
    async with session_scope() as session:
        methods = await account_service.proofs_for(session, user.email)
        linked = await sso_service.identities_of(session, user.email)
    return ReauthStateOut(
        methods=methods,
        providers=[SsoChoiceOut(slug=row.slug, name=row.name) for row in linked],
        proven_at=iso(user.reauth_at) if user.recently_proven else None,
        window_minutes=int(REAUTH_WINDOW.total_seconds() // 60),
    )


@router.post("/api/auth/reauth", response_model=OkOut)
async def reauth(
    payload: ReauthInput, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Confirm it is you with your password, for the next quarter of an hour."""
    await consume("reauth", user.id)
    async with session_scope() as session:
        current_hash = await workspace_service.password_hash_for(session, user.email)
    if current_hash is None or not await verify_password(current_hash, payload.password):
        await note(request, user.id, "failed", "password")
        raise _wrong_password()
    await mark_proven(user.session_id)
    await note(request, user.id, "confirmed", "password")
    return OkOut()


@router.post("/api/auth/password", response_model=OkOut)
async def change_password(
    payload: ChangePasswordInput, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    """A new password, chosen while signed in. Every other browser is signed out."""
    await consume("reauth", user.id)
    async with session_scope() as session:
        current_hash = await workspace_service.password_hash_for(session, user.email)
    if current_hash is not None:
        # Knowing the current password is the proof here; no separate confirmation.
        if payload.current_password is None or not await verify_password(
            current_hash, payload.current_password
        ):
            await note(request, user.id, "failed", "password")
            raise AppError(
                400,
                "wrong_password",
                "That isn't your current password.",
                field="currentPassword",
            )
    else:
        # A first password for somebody who signs in another way: confirm it is them.
        assert_recent_auth(user)

    new_hash = await hash_password(payload.new_password)
    async with transaction() as (session, after):
        signed_out = await account_service.change_password(
            session, email=user.email, password_hash=new_hash, keep_session_id=user.session_id
        )
        await account_service.record_event(
            session,
            user_id=user.id,
            kind="password_changed",
            method="password",
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
        after.add(lambda: hub.close_users(signed_out))
    # Choosing a password is as good a proof as typing one.
    await mark_proven(user.session_id)
    return OkOut()


# ─── invitations ──────────────────────────────────────────────────────────────
@router.post("/api/invites", response_model=InviteOut)
async def create_invite(
    request: Request,
    payload: CreateInviteInput | None = None,
    user: SessionUser = Depends(require_admin),
) -> InviteOut:
    payload = payload or CreateInviteInput()
    # Roles are the owner's to give (`set_role` is owner-only), and an invitation that
    # carries one is giving it. An admin minting admin invites could keep a spare admin
    # account in reserve that outlives their own demotion.
    if payload.role == "admin" and user.role != "owner":
        raise forbidden("Only the owner can invite an admin.")
    if payload.role == "admin":
        # Handing out a role is handing out reach; see `require_recent_auth`.
        assert_recent_auth(user)
    await consume("invite", user.id)
    async with transaction() as (session, _):
        token, expires_at, workspace_name = await signup_service.create_invite(
            session,
            actor_for(request, user),
            email=payload.email,
            role=payload.role,
            expires_in_days=payload.expires_in_days,
            channel_ids=list(payload.channel_ids),
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


@router.post("/api/auth/reset-password", response_model=ResetOut)
async def reset_password(
    payload: ResetPasswordInput, request: Request, response: Response
) -> ResetOut:
    await consume("password_reset_finish", client_key(request))
    async with transaction() as (session, after):
        # The token first, the hash second. Hashing is the expensive half — argon2 at
        # 64 MiB on a shared thread pool — and it used to run before the token was
        # looked at, so a stream of made-up tokens cost the server a hash apiece and
        # stalled every sign-in queued behind them.
        claim = await account_service.claim_password_reset(session, payload.token)
        user_id, signed_out = await account_service.finish_password_reset(
            session, claim, await hash_password(payload.password)
        )
        # The sockets those sessions are holding, past COMMIT: a connection
        # authenticates once, so a socket opened with a since-deleted session keeps
        # delivering until the tab is closed.
        after.add(lambda: hub.close_users(signed_out))
        two_step = await passkey_service.two_step_required(session, claim.email)
    if two_step:
        return ResetOut(signed_in=False)
    await start_session(request, response, user_id, method="reset")
    return ResetOut()


__all__ = ["router"]
