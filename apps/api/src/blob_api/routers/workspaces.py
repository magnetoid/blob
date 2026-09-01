"""Belonging to more than one workspace, and moving between them.

A person is several user rows — one per workspace — so "switching workspace" is not a
setting on an account. It is signing in as the other account, which this does for them:
the cookie is swapped for a session on the row they hold in the workspace they picked.

No password is asked for on the way. They proved who they were when they signed in, the
rows are the same person by definition (same address, same password, kept in step by
`services/workspaces`), and prompting again would be asking someone to re-prove something
they have not stopped being.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response

from ..db.engine import session_scope, transaction
from ..lib.auth import (
    SessionUser,
    create_session,
    current_user,
    destroy_session,
    set_session_cookie,
)
from ..lib.ids import IdParam
from ..schemas.base import CamelModel
from ..services import workspaces as workspace_service

router = APIRouter(tags=["workspaces"])


class WorkspaceMembership(CamelModel):
    """One workspace this person can reach, and who they are inside it."""

    id: str
    name: str
    slug: str
    role: str
    current: bool


class MyWorkspacesOut(CamelModel):
    workspaces: list[WorkspaceMembership]


class SwitchedOut(CamelModel):
    workspace_id: str
    user_id: str


@router.get("/api/workspaces/mine", response_model=MyWorkspacesOut)
async def my_workspaces(user: SessionUser = Depends(current_user)) -> MyWorkspacesOut:
    """Every workspace this address has a live account in."""
    async with session_scope() as session:
        rows = await workspace_service.for_email(session, user.email)

    return MyWorkspacesOut(
        workspaces=[
            WorkspaceMembership(
                id=row.id,
                name=row.name,
                slug=row.slug,
                role=row.role,
                current=row.id == user.workspace_id,
            )
            for row in rows
        ]
    )


@router.post("/api/workspaces/{workspace_id}/switch", response_model=SwitchedOut)
async def switch_workspace(
    workspace_id: IdParam,
    request: Request,
    response: Response,
    user: SessionUser = Depends(current_user),
) -> SwitchedOut:
    """Swap this browser's session to the account this person holds in another workspace.

    The old session is revoked rather than left behind. A cookie can only carry one, so
    keeping it would leave a session nobody can reach and nobody can sign out — which is
    exactly the kind of row that accumulates until someone audits the table and finds
    thousands.
    """
    async with transaction() as (session, _):
        target = await workspace_service.user_row_in(session, workspace_id, user.email)

    await destroy_session(user.session_id)
    token = await create_session(
        target.id,
        request.headers.get("user-agent"),
        request.client.host if request.client else None,
    )
    set_session_cookie(response, token)
    return SwitchedOut(workspace_id=workspace_id, user_id=target.id)
