"""Exports (M3 · B4): asking for one, seeing how it went, and fetching it.

Two doors with different keys. `/api/me/exports` is a person's own — everything they are
in — and `/api/admin/exports` is the workspace's public conversations, an admin's. Both
ask whoever is asking to have signed in recently (ADR 0031): an export is everything at
once, and a session left open on somebody else's desk should not be enough to take it.
A download answers to whoever asked for it, and a workspace export to its admins too.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user, require_recent_admin, require_recent_auth
from ..lib.errors import bad_request, not_found
from ..lib.ids import IdParam
from ..lib.queue import enqueue, fire_and_forget
from ..lib.rate_limit import consume
from ..lib.storage import presign_download
from ..schemas.base import CamelModel, iso, require_iso
from ..services import audit as audit_service
from ..services import exports as export_service
from ..services.audit import actor_for

router = APIRouter()


class ExportOut(CamelModel):
    id: str
    scope: str
    #: "pending" | "running" | "done" | "failed"
    status: str
    bytes: int | None = None
    error: str | None = None
    created_at: str
    finished_at: str | None = None
    requested_by_name: str
    #: Present once it is built: Blob's own link, which checks who is asking.
    download_url: str | None = None


class ExportsOut(CamelModel):
    exports: list[ExportOut]


def _out(row: Any) -> ExportOut:
    return ExportOut(
        id=str(row.id),
        scope=row.scope,
        status=row.status,
        bytes=row.bytes,
        error=row.error,
        created_at=require_iso(row.created_at),
        finished_at=iso(row.finished_at),
        requested_by_name=row.requested_by_name,
        download_url=f"/api/exports/{row.id}/download" if row.status == "done" else None,
    )


async def _start(user: SessionUser, scope: str, request: Request | None) -> ExportsOut:
    await consume("export", user.id)
    async with transaction() as (session, after):
        if await export_service.in_progress(session, user.id):
            raise bad_request("An export of yours is already being built. It will be here soon.")
        export_id = await export_service.request(
            session, workspace_id=user.workspace_id, requested_by=user.id, scope=scope
        )
        if request is not None:
            await audit_service.record(
                session,
                actor_for(request, user),
                "export.requested",
                target_type="workspace",
                target_id=user.workspace_id,
                metadata={"scope": scope},
            )
        after.add(lambda: fire_and_forget(enqueue("build_export", export_id)))
        rows = await export_service.listing(
            session,
            workspace_id=user.workspace_id,
            requested_by=user.id if scope == "personal" else None,
            scope=scope,
        )
    return ExportsOut(exports=[_out(row) for row in rows])


@router.get("/api/me/exports", response_model=ExportsOut)
async def my_exports(user: SessionUser = Depends(current_user)) -> ExportsOut:
    async with session_scope() as session:
        rows = await export_service.listing(
            session, workspace_id=user.workspace_id, requested_by=user.id, scope="personal"
        )
    return ExportsOut(exports=[_out(row) for row in rows])


@router.post("/api/me/exports", response_model=ExportsOut)
async def export_mine(user: SessionUser = Depends(require_recent_auth)) -> ExportsOut:
    """Everything you are in: your channels, your DMs and group DMs."""
    return await _start(user, "personal", None)


@router.get("/api/admin/exports", response_model=ExportsOut)
async def workspace_exports(user: SessionUser = Depends(require_recent_admin)) -> ExportsOut:
    async with session_scope() as session:
        rows = await export_service.listing(
            session, workspace_id=user.workspace_id, requested_by=None, scope="workspace"
        )
    return ExportsOut(exports=[_out(row) for row in rows])


@router.post("/api/admin/exports", response_model=ExportsOut)
async def export_workspace(
    request: Request, user: SessionUser = Depends(require_recent_admin)
) -> ExportsOut:
    """The workspace's public channels and its people — never a private channel or a DM."""
    return await _start(user, "workspace", request)


@router.get("/api/exports/{export_id}/download")
async def download_export(
    export_id: IdParam, user: SessionUser = Depends(current_user)
) -> RedirectResponse:
    async with session_scope() as session:
        row = await export_service.get(session, export_id)
    allowed = (
        row is not None and row.status == "done" and str(row.workspace_id) == user.workspace_id
    )
    if allowed and str(row.requested_by) != user.id:
        # Somebody else's personal export is nobody else's; a workspace one is its admins'.
        allowed = row.scope == "workspace" and user.is_admin
    if not allowed:
        raise not_found("There is no such export.")
    stamp = row.created_at.strftime("%Y%m%d")
    return RedirectResponse(
        presign_download(
            row.object_key, filename=f"blob-{row.scope}-export-{stamp}.zip", mime="application/zip"
        ),
        status_code=302,
    )
