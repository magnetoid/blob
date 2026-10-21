"""Passkeys: adding them, using them, and asking for one after a password (ADR 0032).

Shape and authorize; `services/passkeys.py` holds the ceremonies. Three of these routes
are reached signed out — the two halves of signing in with a passkey and the second step
after a password — and are exact pairs in `main.PUBLIC_ROUTES`. Adding or removing a
passkey, or turning the second step on or off, changes how the person signs in, so each
needs a fresh proof (ADR 0031).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, mark_proven, require_recent_auth
from ..lib.caller import client_key
from ..lib.errors import AppError, unauthorized
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..schemas.base import CamelModel, OkOut, iso
from ..services import accounts as account_service
from ..services import passkeys as passkey_service
from ..services import workspaces as workspace_service
from ..services.serialize import to_current_user
from .auth import PasskeyChallengeOut, SessionOut, note, start_session

router = APIRouter(tags=["passkeys"])


class PasskeyOut(CamelModel):
    id: str
    name: str
    created_at: str | None
    last_used_at: str | None
    #: Synced to the person's other devices by their password manager, rather than held
    #: by one device alone.
    backed_up: bool


class PasskeysOut(CamelModel):
    passkeys: list[PasskeyOut]
    #: Whether a right password is only half a sign-in for this person.
    two_step: bool


class PasskeyOptionsOut(CamelModel):
    #: The options as `PublicKeyCredential.parse*OptionsFromJSON` takes them.
    options: dict[str, Any]


class AddPasskeyIn(CamelModel):
    #: `PublicKeyCredential.toJSON()` from `navigator.credentials.create`.
    credential: dict[str, Any]
    name: str | None = Field(default=None, max_length=60)


class RenamePasskeyIn(CamelModel):
    name: str = Field(min_length=1, max_length=60)


class PasskeyAnswerIn(CamelModel):
    flow_id: str = Field(min_length=10, max_length=100)
    #: `PublicKeyCredential.toJSON()` from `navigator.credentials.get`.
    credential: dict[str, Any]


class RemovedPasskeyOut(CamelModel):
    #: For the browser to tell the person's password manager (the Signal API) that this
    #: key no longer opens anything here, so it stops offering it.
    credential_id: str


class TwoStepIn(CamelModel):
    on: bool


def _passkey_out(row: Any) -> PasskeyOut:
    return PasskeyOut(
        id=str(row.id),
        name=row.name,
        created_at=iso(row.created_at),
        last_used_at=iso(row.last_used_at),
        backed_up=bool(row.backed_up),
    )


# ─── yours ────────────────────────────────────────────────────────────────────


@router.get("/api/auth/passkeys", response_model=PasskeysOut)
async def list_passkeys(user: SessionUser = Depends(current_user)) -> PasskeysOut:
    async with session_scope() as session:
        rows = await passkey_service.list_for(session, user.email)
        two_step = await passkey_service.two_step_required(session, user.email)
    return PasskeysOut(passkeys=[_passkey_out(row) for row in rows], two_step=two_step)


@router.post("/api/auth/passkeys/options", response_model=PasskeyOptionsOut)
async def passkey_options(user: SessionUser = Depends(require_recent_auth)) -> PasskeyOptionsOut:
    """The first half of adding a passkey: what `navigator.credentials.create` needs."""
    async with transaction() as (session, _):
        options = await passkey_service.begin_registration(
            session, email=user.email, display_name=user.display_name, session_id=user.session_id
        )
    return PasskeyOptionsOut(options=options)


@router.post("/api/auth/passkeys", response_model=PasskeyOut, status_code=201)
async def add_passkey(
    payload: AddPasskeyIn, request: Request, user: SessionUser = Depends(require_recent_auth)
) -> PasskeyOut:
    async with transaction() as (session, _):
        added = await passkey_service.finish_registration(
            session,
            email=user.email,
            session_id=user.session_id,
            credential=payload.credential,
            name=payload.name,
        )
    await note(request, user.id, "passkey_added", "passkey")
    return PasskeyOut(
        id=added.id, name=added.name, created_at=None, last_used_at=None, backed_up=added.backed_up
    )


@router.patch("/api/auth/passkeys/{passkey_id}", response_model=OkOut)
async def rename_passkey(
    passkey_id: IdParam, payload: RenamePasskeyIn, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, _):
        await passkey_service.rename(
            session, email=user.email, passkey_id=passkey_id, name=payload.name
        )
    return OkOut()


@router.delete("/api/auth/passkeys/{passkey_id}", response_model=RemovedPasskeyOut)
async def remove_passkey(
    passkey_id: IdParam, request: Request, user: SessionUser = Depends(require_recent_auth)
) -> RemovedPasskeyOut:
    async with transaction() as (session, _):
        credential_id = await passkey_service.remove(
            session, email=user.email, passkey_id=passkey_id
        )
    await note(request, user.id, "passkey_removed", "passkey")
    return RemovedPasskeyOut(credential_id=credential_id)


@router.put("/api/auth/two-step", response_model=OkOut)
async def set_two_step(
    payload: TwoStepIn, request: Request, user: SessionUser = Depends(require_recent_auth)
) -> OkOut:
    """Whether signing in with the password also asks for one of your passkeys."""
    async with transaction() as (session, _):
        await passkey_service.set_two_step(session, email=user.email, on=payload.on)
    await note(request, user.id, "two_step_on" if payload.on else "two_step_off")
    return OkOut()


# ─── confirming it is you, with one ───────────────────────────────────────────


@router.post("/api/auth/reauth/passkey/options", response_model=PasskeyChallengeOut)
async def confirm_options(user: SessionUser = Depends(current_user)) -> PasskeyChallengeOut:
    await consume("reauth", user.id)
    async with session_scope() as session:
        flow_id, options = await passkey_service.begin_authentication(
            session, purpose="confirm", email=user.email, session_id=user.session_id
        )
    return PasskeyChallengeOut(flow_id=flow_id, options=options)


@router.post("/api/auth/reauth/passkey", response_model=OkOut)
async def confirm(
    payload: PasskeyAnswerIn, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, _):
        proven = await passkey_service.finish_authentication(
            session, flow_id=payload.flow_id, credential=payload.credential, purpose="confirm"
        )
    # The flow was minted for this session and named this person; a confirmation carried
    # to another session's request proves nothing about that one.
    if proven.session_id != user.session_id:
        raise AppError(400, "passkey_refused", "That confirmation was for another session.")
    await mark_proven(user.session_id)
    await note(request, user.id, "confirmed", "passkey")
    return OkOut()


# ─── signing in with one ──────────────────────────────────────────────────────


@router.post("/api/auth/passkey/options", response_model=PasskeyChallengeOut)
async def sign_in_options(request: Request) -> PasskeyChallengeOut:
    """A challenge any of this server's passkeys can answer. Names nobody: the browser
    offers whichever passkeys it holds for this server, or fills one into the form."""
    await consume("passkey_options", client_key(request))
    async with session_scope() as session:
        flow_id, options = await passkey_service.begin_authentication(session, purpose="sign_in")
    return PasskeyChallengeOut(flow_id=flow_id, options=options)


@router.post("/api/auth/passkey/sign-in", response_model=SessionOut)
async def sign_in(payload: PasskeyAnswerIn, request: Request, response: Response) -> SessionOut:
    await consume("login", client_key(request))
    async with transaction() as (session, _):
        proven = await passkey_service.finish_authentication(
            session, flow_id=payload.flow_id, credential=payload.credential, purpose="sign_in"
        )
    async with session_scope() as session:
        row = await account_service.find_for_login(session, proven.email)
    if row is None:
        raise unauthorized("That passkey no longer opens an account here.")
    if row.deactivated_at is not None:
        raise unauthorized("That account has been deactivated.")
    await start_session(request, response, row.id, method="passkey")
    async with session_scope() as session:
        instance_admin = await workspace_service.is_instance_admin(session, row.email)
    return SessionOut(user=to_current_user(row, is_instance_admin=instance_admin))


@router.post("/api/auth/two-step", response_model=SessionOut)
async def second_step(payload: PasskeyAnswerIn, request: Request, response: Response) -> SessionOut:
    """The passkey after a right password, for a person who asked for both. The flow was
    minted by that password check and names the account it was for."""
    await consume("login", client_key(request))
    async with transaction() as (session, _):
        proven = await passkey_service.finish_authentication(
            session, flow_id=payload.flow_id, credential=payload.credential, purpose="two_step"
        )
    if proven.user_id is None:
        raise unauthorized()
    async with session_scope() as session:
        row = await account_service.find_for_login(session, proven.email)
    if row is None or str(row.id) != proven.user_id or row.deactivated_at is not None:
        raise unauthorized("Sign in again.")
    await start_session(request, response, row.id, method="two_step")
    async with session_scope() as session:
        instance_admin = await workspace_service.is_instance_admin(session, row.email)
    return SessionOut(user=to_current_user(row, is_instance_admin=instance_admin))


__all__ = ["router"]
