"""Calls: a huddle or a meetup in a conversation. Thin, like the other routers — the
service authorises against the conversation and broadcasts after commit."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from ..db.engine import session_scope, transaction
from ..lib import livekit, rate_limit
from ..lib.auth import SessionUser, current_user
from ..lib.errors import unauthorized
from ..lib.ids import IdParam
from ..schemas.calls import Call, CallsState, CallStart, CallToken
from ..services import calls

router = APIRouter(prefix="/api/calls", tags=["calls"])

#: The webhook is the one unauthenticated POST this router answers. Refusing an
#: oversized body before verifying anything keeps a flood from being a signal in
#: itself — LiveKit's own events are one JSON object about one room, never megabytes.
WEBHOOK_MAX_BYTES = 64 * 1024


@router.get("", response_model=CallsState)
async def calls_state(user: SessionUser = Depends(current_user)) -> CallsState:
    async with session_scope() as session:
        return await calls.state_for(session, user)


@router.post("", response_model=Call)
async def start_call(input_: CallStart, user: SessionUser = Depends(current_user)) -> Call:
    await rate_limit.consume("start_call", user.id)
    async with transaction() as (session, after):
        return await calls.start(session, after, user, input_.channel_id, input_.kind)


@router.post("/{call_id}/token", response_model=CallToken)
async def call_token(call_id: IdParam, user: SessionUser = Depends(current_user)) -> CallToken:
    # Its own bucket, not `start_call`'s: joining is more frequent than starting, so a
    # reload storm would look like abuse in a shared one.
    await rate_limit.consume("call_token", user.id)
    return await calls.token(user, call_id)


@router.post("/{call_id}/end", response_model=Call)
async def end_call(call_id: IdParam, user: SessionUser = Depends(current_user)) -> Call:
    # `calls.end` opens its own transaction and closes the LiveKit room only after it
    # has committed, so the router hands it no session to keep open across that call.
    return await calls.end(user, call_id)


@router.post("/livekit", include_in_schema=False)
async def livekit_webhook(request: Request) -> Response:
    """LiveKit's webhooks. Public — LiveKit holds no session — and listed as an exact
    route in `PUBLIC_ROUTES`. What makes an event real is the signature over its body."""
    raw = await request.body()
    if len(raw) > WEBHOOK_MAX_BYTES:
        # The same refusal a bad signature gets: nothing about it tells an attacker
        # which check failed.
        raise unauthorized("That is not a LiveKit this server knows.")
    body = raw.decode("utf-8", errors="replace")
    try:
        event = livekit.receive(body, request.headers.get("authorization", ""))
    except livekit.BadSignature:
        raise unauthorized("That is not a LiveKit this server knows.") from None
    await calls.apply_webhook(event)
    return Response(status_code=200)
