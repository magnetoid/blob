"""Single sign-on: starting a round trip, finishing it, and a person's linked providers
(ADR 0033). Shape and authorize; `services/sso.py` holds the protocol.

Every round trip starts with a POST from this origin — `/api/auth/sso/begin` — which
answers the provider's address and sets a short cookie holding the state, so the callback
can tell the browser that started a sign-in from one that was merely sent a link to
finish someone else's (login CSRF). Starting with a POST also lets "confirm it's you" and
linking go through the ordinary `reauth_required` handling first. The two routes reached
signed out are exact pairs in `main.PUBLIC_ROUTES`.
"""

from __future__ import annotations

import html
import secrets
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import Field

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import (
    SessionUser,
    assert_recent_auth,
    current_user,
    mark_proven,
    require_recent_auth,
)
from ..lib.caller import client_ip, client_key
from ..lib.errors import AppError, not_found, unauthorized
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..schemas.base import CamelModel, OkOut, iso
from ..services import accounts as account_service
from ..services import signup as signup_service
from ..services import sso as sso_service
from .auth import start_session

router = APIRouter(tags=["sso"])

#: The state of the round trip in flight, bound to the browser that began it.
SSO_COOKIE = "blob_sso"
COOKIE_PATH = "/api/auth/sso"


class SsoBeginIn(CamelModel):
    provider: str = Field(min_length=1, max_length=40)
    intent: Literal["sign_in", "confirm", "link"] = "sign_in"
    #: Where a sign-in lands afterwards: a path on this server.
    next: str | None = Field(default=None, max_length=512)
    #: The invitation a new person arrived with.
    invite: str | None = Field(default=None, max_length=200)


class SsoBeginOut(CamelModel):
    #: The provider's sign-in page, for the browser to go to (or open in a window, to
    #: confirm it's you without leaving the page).
    url: str


class SsoIdentityOut(CamelModel):
    provider_id: str
    slug: str
    name: str
    linked_at: str | None
    last_used_at: str | None


class SsoProviderChoice(CamelModel):
    slug: str
    name: str


class SsoIdentitiesOut(CamelModel):
    identities: list[SsoIdentityOut]
    #: Providers this person could link and has not.
    available: list[SsoProviderChoice]


def _set_state_cookie(response: Response, state: str) -> None:
    response.set_cookie(
        SSO_COOKIE,
        state,
        httponly=True,
        samesite="lax",
        secure=settings.is_prod,
        path=COOKIE_PATH,
        max_age=sso_service.FLOW_SEC,
    )


@router.post("/api/auth/sso/begin", response_model=SsoBeginOut)
async def begin(payload: SsoBeginIn, request: Request, response: Response) -> SsoBeginOut:
    await consume("sso", client_key(request))
    user: SessionUser | None = getattr(request.state, "user", None)
    if payload.intent != "sign_in":
        if user is None:
            raise unauthorized()
        if payload.intent == "link":
            # Linking adds a way into the account; it gets the same confirmation as
            # adding a passkey (ADR 0031).
            assert_recent_auth(user)
    async with session_scope() as session:
        provider = await sso_service.provider_by(session, slug=payload.provider)
    if provider is None or not provider.enabled:
        raise not_found("That sign-in option is not available.")
    try:
        state, url = await sso_service.begin(
            provider,
            intent=payload.intent,
            next_path=payload.next,
            session_id=user.session_id if user and payload.intent != "sign_in" else None,
            invite_token=payload.invite if payload.intent == "sign_in" else None,
        )
    except sso_service.SsoError as refused:
        raise AppError(
            502, "sso_unavailable", f"{provider.name} could not be reached. {refused.detail}"
        ) from refused
    _set_state_cookie(response, state)
    return SsoBeginOut(url=url)


def _landing(intent: str, *, error: str | None = None, done: str | None = None) -> str:
    base = "/settings/security" if intent == "link" else "/"
    if error:
        return f"{base}?sso_error={error}"
    if done:
        return f"{base}?sso={done}"
    return base


def _confirm_page(message: str, *, ok: bool) -> HTMLResponse:
    """What the small window shows at the end of "confirm it's you". No script: the page
    that opened it notices on its own and closes it."""
    title = "Confirmed" if ok else "Not confirmed"
    body = (
        "<!doctype html><html lang=en><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width'>"
        f"<title>{title}</title>"
        "<body style='font:16px system-ui,sans-serif;margin:3rem auto;max-width:28rem;"
        "padding:0 1.5rem;color:#1d2420'>"
        f"<h1 style='font-size:1.25rem'>{title}</h1><p>{html.escape(message, quote=False)}</p>"
        "<p style='color:#5b6660'>You can close this window.</p></body></html>"
    )
    return HTMLResponse(body, status_code=200 if ok else 400)


def _finish_redirect(url: str) -> RedirectResponse:
    response = RedirectResponse(url, status_code=303)
    response.delete_cookie(SSO_COOKIE, path=COOKIE_PATH)
    return response


@router.get("/api/auth/sso/callback", response_model=None)
async def callback(
    request: Request,
    state: str = Query(default="", max_length=200),
    code: str | None = Query(default=None, max_length=4096),
    iss: str | None = Query(default=None, max_length=512),
    error: str | None = Query(default=None, max_length=200),
) -> Response:
    await consume("sso", client_key(request))
    bound = request.cookies.get(SSO_COOKIE, "")
    if not state or not bound or not secrets.compare_digest(bound, state):
        # Not the browser that began this round trip — or a link replayed later.
        return _finish_redirect(_landing("sign_in", error="expired"))
    if error is not None or not code:
        # The person said no at the provider, or the provider refused them. Spend the
        # state either way, so the same answer cannot be brought back.
        await sso_service.abandon(state)
        return _finish_redirect(_landing("sign_in", error="denied"))
    try:
        async with transaction() as (session, _):
            flow, provider, claims = await sso_service.finish(
                session, state=state, code=code, iss=iss
            )
    except sso_service.SsoError as refused:
        return _finish_redirect(_landing("sign_in", error=refused.code))

    user: SessionUser | None = getattr(request.state, "user", None)
    if flow.intent == "confirm":
        return await _confirm(request, flow, provider, claims, user)
    if flow.intent == "link":
        return await _link(request, flow, provider, claims, user)
    return await _sign_in(request, flow, provider, claims)


async def _confirm(
    request: Request, flow: Any, provider: Any, claims: dict[str, Any], user: SessionUser | None
) -> Response:
    if user is None or user.session_id != flow.session_id:
        return _confirm_page("This window was not opened by the page that asked.", ok=False)
    async with transaction() as (session, _):
        email = await sso_service.linked_address(session, provider, str(claims["sub"]))
    if email is None or email.lower() != user.email.lower():
        return _confirm_page(
            f"That {provider.name} account is not the one linked to you here.", ok=False
        )
    await mark_proven(user.session_id)
    async with transaction() as (session, _):
        await account_service.record_event(
            session,
            user_id=user.id,
            kind="confirmed",
            method="sso",
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    response = _confirm_page("That's you. Whatever you were doing can go ahead.", ok=True)
    response.delete_cookie(SSO_COOKIE, path=COOKIE_PATH)
    return response


async def _link(
    request: Request, flow: Any, provider: Any, claims: dict[str, Any], user: SessionUser | None
) -> Response:
    if user is None or user.session_id != flow.session_id:
        return _finish_redirect(_landing("link", error="expired"))
    try:
        async with transaction() as (session, _):
            await sso_service.link(session, provider, subject=str(claims["sub"]), email=user.email)
            await account_service.record_event(
                session,
                user_id=user.id,
                kind="sso_linked",
                method="sso",
                ip=client_ip(request),
                user_agent=request.headers.get("user-agent"),
            )
    except sso_service.SsoError as refused:
        return _finish_redirect(_landing("link", error=refused.code))
    return _finish_redirect(_landing("link", done="linked"))


async def _sign_in(request: Request, flow: Any, provider: Any, claims: dict[str, Any]) -> Response:
    subject = str(claims["sub"])
    try:
        async with transaction() as (session, _):
            email = await sso_service.linked_address(session, provider, subject)
            newly_linked = False
            if email is None:
                verified = sso_service.verified_email(claims)
                if verified is None:
                    raise sso_service.SsoError("email_unverified")
                if not provider.allows(verified):
                    raise sso_service.SsoError("domain")
                if await sso_service.has_account(session, verified):
                    if not provider.link_by_email:
                        raise sso_service.SsoError("not_linked")
                else:
                    if flow.invite_token is None and not provider.allowed_domains:
                        # Saved before domains were required for this: a provider that
                        # names none lets nobody new in on its own say-so.
                        raise sso_service.SsoError("no_account")
                    await signup_service.join_by_identity(
                        session,
                        email=verified,
                        display_name=sso_service.display_name(claims, verified),
                        invite_token=flow.invite_token,
                        workspace_id=None if flow.invite_token else provider.join_workspace_id,
                    )
                await sso_service.link(session, provider, subject=subject, email=verified)
                email = verified
                newly_linked = True
            row = await account_service.find_for_login(session, email)
            if row is None:
                raise sso_service.SsoError("no_account")
            if row.deactivated_at is not None:
                raise sso_service.SsoError("deactivated")
            if newly_linked:
                await account_service.record_event(
                    session,
                    user_id=str(row.id),
                    kind="sso_linked",
                    method="sso",
                    ip=client_ip(request),
                    user_agent=request.headers.get("user-agent"),
                )
    except sso_service.SsoError as refused:
        return _finish_redirect(_landing("sign_in", error=refused.code))
    except AppError as refused:
        # An invitation that has lapsed, a name already taken: said on the sign-in page.
        return _finish_redirect(_landing("sign_in", error=refused.code))
    response = _finish_redirect(flow.next_path)
    await start_session(request, response, str(row.id), method="sso")
    return response


# ─── yours ────────────────────────────────────────────────────────────────────


@router.get("/api/auth/sso/identities", response_model=SsoIdentitiesOut)
async def identities(user: SessionUser = Depends(current_user)) -> SsoIdentitiesOut:
    async with session_scope() as session:
        rows = await sso_service.identities_of(session, user.email)
        providers = await sso_service.enabled_providers(session)
    linked = {str(row.id) for row in rows}
    return SsoIdentitiesOut(
        identities=[
            SsoIdentityOut(
                provider_id=str(row.id),
                slug=row.slug,
                name=row.name,
                linked_at=iso(row.created_at),
                last_used_at=iso(row.last_used_at),
            )
            for row in rows
        ],
        available=[
            SsoProviderChoice(slug=provider.slug, name=provider.name)
            for provider in providers
            if provider.id not in linked
        ],
    )


@router.delete("/api/auth/sso/identities/{provider_id}", response_model=OkOut)
async def unlink(
    provider_id: IdParam, request: Request, user: SessionUser = Depends(require_recent_auth)
) -> OkOut:
    async with transaction() as (session, _):
        await sso_service.unlink(session, email=user.email, provider_id=provider_id)
        await account_service.record_event(
            session,
            user_id=user.id,
            kind="sso_unlinked",
            method="sso",
            ip=client_ip(request),
            user_agent=request.headers.get("user-agent"),
        )
    return OkOut()


__all__ = ["router"]
