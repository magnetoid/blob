"""Single sign-on providers, for the server's administrator (ADR 0033).

A provider is the server's — one person is one address across every workspace here — so
it is set up from the instance console, not a workspace's. Adding, changing or removing
one changes who can get in, so each asks for a fresh proof (ADR 0031). The client secret
goes in and never comes back out: the page says whether one is set, nothing more.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request
from pydantic import Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_instance_admin, require_recent_instance_admin
from ..lib.errors import bad_request
from ..lib.ids import IdParam
from ..schemas.base import CamelModel, OkOut
from ..services import audit as audit_service
from ..services import sso as sso_service
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin/instance/sso")

_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,30}$")


class SsoProviderOut(CamelModel):
    id: str
    slug: str
    name: str
    issuer: str
    client_id: str
    scopes: str
    allowed_domains: list[str]
    link_by_email: bool
    join_workspace_id: str | None
    enabled: bool
    #: Whether a client secret is set. The secret itself is never sent back.
    has_secret: bool
    #: How many people sign in through it.
    linked: int


class SsoProvidersOut(CamelModel):
    providers: list[SsoProviderOut]
    #: The one redirect address to register at every provider.
    callback_url: str


class SsoProviderIn(CamelModel):
    name: str = Field(min_length=1, max_length=60)
    issuer: str = Field(min_length=8, max_length=512)
    client_id: str = Field(min_length=1, max_length=512)
    #: Blank keeps the one already set; none at all makes this a public client.
    client_secret: str | None = Field(default=None, max_length=2048)
    scopes: str = Field(default="openid email profile", max_length=512)
    allowed_domains: list[str] = Field(default_factory=list, max_length=50)
    link_by_email: bool = True
    join_workspace_id: str | None = None
    enabled: bool = True

    @field_validator("scopes")
    @classmethod
    def _has_openid(cls, value: str) -> str:
        if "openid" not in value.split():
            raise ValueError("The scopes must include openid.")
        return value


class SsoProviderCreateIn(SsoProviderIn):
    slug: str = Field(min_length=2, max_length=31)

    @field_validator("slug")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not _SLUG.match(value):
            raise ValueError("Use lowercase letters, numbers and hyphens.")
        return value


class SsoCheckOut(CamelModel):
    ok: bool
    message: str


def _data(payload: SsoProviderIn) -> sso_service.ProviderInput:
    return sso_service.ProviderInput(
        name=payload.name,
        issuer=payload.issuer,
        client_id=payload.client_id,
        client_secret=(payload.client_secret or "").strip() or None,
        scopes=payload.scopes,
        allowed_domains=payload.allowed_domains,
        link_by_email=payload.link_by_email,
        join_workspace_id=payload.join_workspace_id,
        enabled=payload.enabled,
    )


async def _out(session: AsyncSession, provider: sso_service.Provider) -> SsoProviderOut:
    return SsoProviderOut(
        id=provider.id,
        slug=provider.slug,
        name=provider.name,
        issuer=provider.issuer,
        client_id=provider.client_id,
        scopes=provider.scopes,
        allowed_domains=list(provider.allowed_domains),
        link_by_email=provider.link_by_email,
        join_workspace_id=provider.join_workspace_id,
        enabled=provider.enabled,
        has_secret=await sso_service.has_secret(session, provider.id),
        linked=await sso_service.linked_count(session, provider.id),
    )


@router.get("", response_model=SsoProvidersOut)
async def list_providers(_admin: SessionUser = Depends(require_instance_admin)) -> SsoProvidersOut:
    async with session_scope() as session:
        providers = [await _out(session, p) for p in await sso_service.all_providers(session)]
    return SsoProvidersOut(providers=providers, callback_url=sso_service.callback_url())


@router.post("", response_model=SsoProviderOut, status_code=201)
async def create_provider(
    payload: SsoProviderCreateIn,
    request: Request,
    admin: SessionUser = Depends(require_recent_instance_admin),
) -> SsoProviderOut:
    async with transaction() as (session, _):
        provider = await sso_service.create_provider(
            session, slug=payload.slug, data=_data(payload), created_by=admin.id
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "sso.provider_created",
            target_type="sso_provider",
            target_id=provider.id,
            metadata={"slug": provider.slug, "issuer": provider.issuer},
        )
        return await _out(session, provider)


@router.put("/{provider_id}", response_model=SsoProviderOut)
async def update_provider(
    provider_id: IdParam,
    payload: SsoProviderIn,
    request: Request,
    admin: SessionUser = Depends(require_recent_instance_admin),
) -> SsoProviderOut:
    async with transaction() as (session, _):
        provider = await sso_service.update_provider(
            session, provider_id=provider_id, data=_data(payload)
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "sso.provider_updated",
            target_type="sso_provider",
            target_id=provider.id,
            metadata={"slug": provider.slug, "enabled": provider.enabled},
        )
        return await _out(session, provider)


@router.delete("/{provider_id}", response_model=OkOut)
async def delete_provider(
    provider_id: IdParam,
    request: Request,
    admin: SessionUser = Depends(require_recent_instance_admin),
) -> OkOut:
    async with transaction() as (session, _):
        await sso_service.delete_provider(session, provider_id)
        await audit_service.record(
            session,
            actor_for(request, admin),
            "sso.provider_deleted",
            target_type="sso_provider",
            target_id=provider_id,
        )
    return OkOut()


@router.post("/{provider_id}/check", response_model=SsoCheckOut)
async def check_provider(
    provider_id: IdParam, _admin: SessionUser = Depends(require_instance_admin)
) -> SsoCheckOut:
    """Ask the provider to describe itself again, so a typo shows here and not at the
    first person's sign-in."""
    async with session_scope() as session:
        provider = await sso_service.provider_by(session, provider_id=provider_id)
    if provider is None:
        raise bad_request("No such provider.")
    sso_service.forget_cached()
    try:
        document = await sso_service.discover(provider.issuer)
    except sso_service.SsoError as refused:
        return SsoCheckOut(ok=False, message=refused.detail or refused.code)
    return SsoCheckOut(
        ok=True,
        message=f"{provider.issuer} answers, and signs in at {document['authorization_endpoint']}.",
    )


__all__ = ["router"]
