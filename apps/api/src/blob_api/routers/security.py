"""`GET /api/admin/security` (M3 · C3): the console's Security page, read live.

Every admin gets the workspace's checks; the server's — how it was deployed — go only to
whoever administers the server, as its logs do (`services/security_posture.py`).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends

from ..db.engine import session_scope
from ..lib.auth import SessionUser, require_admin
from ..schemas.base import CamelModel
from ..services import security_posture as posture
from ..services import workspaces as workspace_service

router = APIRouter(prefix="/api/admin")


class SecurityCheckOut(CamelModel):
    id: str
    title: str
    #: `ok`, `attention` when it is worth a look, `info` when it is a choice either way.
    state: Literal["ok", "attention", "info"]
    detail: str


class SecurityOut(CamelModel):
    workspace: list[SecurityCheckOut]
    #: Null for an admin who does not administer the server.
    server: list[SecurityCheckOut] | None = None


def _out(check: posture.Check) -> SecurityCheckOut:
    return SecurityCheckOut(id=check.id, title=check.title, state=check.state, detail=check.detail)


@router.get("/security", response_model=SecurityOut)
async def security(admin: SessionUser = Depends(require_admin)) -> SecurityOut:
    async with session_scope() as session:
        workspace = await posture.workspace_checks(session, admin.workspace_id)
        runs_server = await workspace_service.is_instance_admin(session, admin.email)
    return SecurityOut(
        workspace=[_out(check) for check in workspace],
        server=[_out(check) for check in posture.server_checks()] if runs_server else None,
    )
