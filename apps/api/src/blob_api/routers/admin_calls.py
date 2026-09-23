"""Agents & apps' neighbour in /admin: Calls. A workspace admin's settings for huddles and
meetups, and — for whoever administers the machine — whether LiveKit is there at all."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_admin, require_instance_admin
from ..schemas.calls import CallSettings, MediaServerStatus
from ..services import calls
from ..services.audit import actor_for
from ..services.workspace_settings import load_calls

router = APIRouter(prefix="/api/admin/calls", tags=["admin"])


@router.get("", response_model=CallSettings)
async def get_call_settings(admin: SessionUser = Depends(require_admin)) -> CallSettings:
    async with session_scope() as session:
        return await load_calls(session, admin.workspace_id)


@router.put("", response_model=CallSettings)
async def put_call_settings(
    payload: CallSettings, request: Request, admin: SessionUser = Depends(require_admin)
) -> CallSettings:
    async with transaction() as (session, after):
        return await calls.save_settings(session, after, actor_for(request, admin), payload)


@router.get("/server", response_model=MediaServerStatus)
async def media_server(_admin: SessionUser = Depends(require_instance_admin)) -> MediaServerStatus:
    return await calls.media_server_status()
