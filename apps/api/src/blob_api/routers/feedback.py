"""Filing feedback, and reading it back in the console.

Anyone in the workspace can file a ticket; only admins can read them. That asymmetry is
the point: a ticket carries a snapshot of whatever the reporter had on screen, which may
include a private channel, so it is admin-only to read even though anyone may write one.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse

from ..db.engine import session_scope
from ..lib.auth import SessionUser, current_user, require_admin
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..lib.storage import get_object
from ..schemas.base import CamelModel
from ..schemas.models import FeedbackTicket
from ..schemas.requests import FeedbackInput, FeedbackStatusInput
from ..services import feedback as feedback_service
from ..services.audit import actor_for

router = APIRouter(tags=["feedback"])


class TicketOut(CamelModel):
    ticket: FeedbackTicket


class TicketsOut(CamelModel):
    tickets: list[FeedbackTicket]


class OkOut(CamelModel):
    ok: bool = True


@router.post("/api/feedback", response_model=TicketOut, status_code=201)
async def submit(payload: FeedbackInput, user: SessionUser = Depends(current_user)) -> TicketOut:
    # Rate limited on the same bucket as uploads: a ticket carries a page snapshot, so a
    # loop filing them is a storage problem as much as a database one.
    await consume("upload", user.id)
    ticket = await feedback_service.create(user.workspace_id, user.id, payload)
    return TicketOut(ticket=ticket)


@router.get("/api/admin/feedback", response_model=TicketsOut)
async def listing(
    status: str | None = None, user: SessionUser = Depends(require_admin)
) -> TicketsOut:
    async with session_scope() as session:
        tickets = await feedback_service.listing(session, user.workspace_id, status)
    return TicketsOut(tickets=tickets)


@router.get("/api/admin/feedback/{ticket_id}/snapshot", response_class=HTMLResponse)
async def snapshot(ticket_id: IdParam, user: SessionUser = Depends(require_admin)) -> HTMLResponse:
    """The captured page, served for an iframe to render.

    Served from here rather than as a redirect to storage so the sandboxing headers are
    ours to set: this is markup written by a browser we do not control, and it is about
    to be rendered inside the admin console.
    """
    async with session_scope() as session:
        key = await feedback_service.snapshot_key_for(session, user.workspace_id, ticket_id)

    body = await get_object(key)
    return HTMLResponse(
        content=body.decode("utf-8", errors="replace"),
        headers={
            # Nothing in a snapshot may execute or phone home. The iframe carries its own
            # sandbox attribute too; this is the half the page cannot remove.
            "Content-Security-Policy": (
                "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"
            ),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


@router.patch("/api/admin/feedback/{ticket_id}", response_model=TicketOut)
async def set_status(
    ticket_id: IdParam,
    payload: FeedbackStatusInput,
    request: Request,
    user: SessionUser = Depends(require_admin),
) -> TicketOut:
    ticket = await feedback_service.set_status(actor_for(request, user), ticket_id, payload.status)
    return TicketOut(ticket=ticket)


@router.delete("/api/admin/feedback/{ticket_id}", response_model=OkOut)
async def remove(
    ticket_id: IdParam, request: Request, user: SessionUser = Depends(require_admin)
) -> OkOut:
    await feedback_service.remove(actor_for(request, user), ticket_id)
    return OkOut()


__all__ = ["router"]
