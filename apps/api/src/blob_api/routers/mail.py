"""Stopping away emails without signing in (ADR 0036).

The link in every away email, and the RFC 8058 one-click POST a mail client sends from
its own servers. The token is the whole authority — it names one account and can do one
thing, turn that account's away emails off — so neither route reads a session. The GET
changes nothing: mail scanners follow links, and a link that unsubscribed on being
fetched would unsubscribe people who never clicked it.
"""

from __future__ import annotations

from fastapi import APIRouter, Query

from ..db.engine import session_scope, transaction
from ..lib.errors import not_found
from ..schemas.base import CamelModel
from ..services import away_mail

router = APIRouter()


class UnsubscribeOut(CamelModel):
    #: Whose emails the link stops, so the page can say so before anybody presses it.
    email: str
    workspace: str
    #: Whether away emails are off for that account now.
    off: bool


def _account(token: str) -> str:
    user_id = away_mail.read_unsubscribe_token(token)
    if user_id is None:
        raise not_found("That link does not work. Change your emails in Blob's settings.")
    return user_id


@router.get("/api/mail/unsubscribe", response_model=UnsubscribeOut)
async def what_the_link_stops(t: str = Query(max_length=512)) -> UnsubscribeOut:
    user_id = _account(t)
    async with session_scope() as session:
        row = await away_mail.recipient_of(session, user_id)
    if row is None:
        raise not_found("That account no longer exists.")
    return UnsubscribeOut(
        email=row.email, workspace=row.workspace_name, off=row.email_when_away == "off"
    )


@router.post("/api/mail/unsubscribe", response_model=UnsubscribeOut)
async def unsubscribe(t: str = Query(max_length=512)) -> UnsubscribeOut:
    """Turn them off. Answers the same however often it is asked: a mail client may
    send the one-click POST more than once."""
    user_id = _account(t)
    async with transaction() as (session, _after):
        row = await away_mail.recipient_of(session, user_id)
        if row is None:
            raise not_found("That account no longer exists.")
        await away_mail.turn_off(session, user_id)
    return UnsubscribeOut(email=row.email, workspace=row.workspace_name, off=True)
