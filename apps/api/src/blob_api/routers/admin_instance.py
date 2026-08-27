"""The instance console: what is true of the whole server, across every workspace.

Everything in routers/admin.py is scoped to the caller's workspace, which is what an
owner or admin running one workspace needs. This module is not: it answers "what is on
this server", which is a different job and, once a server holds more than one
workspace, a different person's.

Gated on `instance_admins`, which is a fact about a *person* rather than a role inside
one workspace — see migration 0011. `owner` stood in for this while there was only ever
one workspace to own, and would have been the wrong answer the moment there were two.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field
from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib import logbuf
from ..lib.auth import SessionUser, require_instance_admin
from ..lib.errors import bad_request
from ..plugins.manifest import SCOPES
from ..schemas.base import CamelModel, iso
from ..services import audit as audit_service
from ..services import policies as policy_service
from ..services import workspaces as workspace_service
from ..services.audit import actor_for

router = APIRouter(tags=["admin"], prefix="/api/admin")


class OkOut(CamelModel):
    ok: bool = True


class InstanceUser(CamelModel):
    id: str
    email: str
    display_name: str
    role: str
    kind: str
    workspace_id: str
    workspace_name: str
    deactivated: bool
    created_at: str


class InstanceUsersOut(CamelModel):
    users: list[InstanceUser]


class InstanceWorkspace(CamelModel):
    id: str
    name: str
    slug: str
    member_count: int
    channel_count: int
    app_count: int
    created_at: str


class InstanceWorkspacesOut(CamelModel):
    workspaces: list[InstanceWorkspace]


@router.get("/instance/users", response_model=InstanceUsersOut)
async def instance_users(
    _admin: SessionUser = Depends(require_instance_admin),
) -> InstanceUsersOut:
    """Every account on the server, whichever workspace it belongs to."""
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT u.id, u.email, u.display_name, u.role, u.kind,
                           u.workspace_id, w.name AS workspace_name,
                           u.deactivated_at, u.created_at
                      FROM users u
                      JOIN workspaces w ON w.id = u.workspace_id
                     ORDER BY w.name, lower(u.display_name) LIMIT 1000
                    """
                )
            )
        ).fetchall()

    return InstanceUsersOut(
        users=[
            InstanceUser(
                id=row.id,
                email=row.email,
                display_name=row.display_name,
                role=row.role,
                kind=row.kind,
                workspace_id=row.workspace_id,
                workspace_name=row.workspace_name,
                deactivated=row.deactivated_at is not None,
                created_at=iso(row.created_at) or "",
            )
            for row in rows
        ]
    )


@router.get("/instance/workspaces", response_model=InstanceWorkspacesOut)
async def instance_workspaces(
    _admin: SessionUser = Depends(require_instance_admin),
) -> InstanceWorkspacesOut:
    """Every workspace on the server, with enough to tell them apart at a glance.

    Counted in one pass with correlated subqueries rather than three joins and a GROUP BY:
    at the number of workspaces a self-hosted server holds, clarity is worth more than the
    query plan, and each count reads as the sentence it answers.
    """
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT w.id, w.name, w.slug, w.created_at,
                           (SELECT count(*) FROM users u
                             WHERE u.workspace_id = w.id
                               AND u.deactivated_at IS NULL) AS member_count,
                           (SELECT count(*) FROM channels c
                             WHERE c.workspace_id = w.id
                               AND c.kind IN ('public', 'private')) AS channel_count,
                           (SELECT count(*) FROM plugins p
                             WHERE p.workspace_id = w.id) AS app_count
                      FROM workspaces w
                     ORDER BY w.created_at LIMIT 1000
                    """
                )
            )
        ).fetchall()

    return InstanceWorkspacesOut(
        workspaces=[
            InstanceWorkspace(
                id=row.id,
                name=row.name,
                slug=row.slug,
                member_count=row.member_count,
                channel_count=row.channel_count,
                app_count=row.app_count,
                created_at=iso(row.created_at) or "",
            )
            for row in rows
        ]
    )


class CreateWorkspaceInput(CamelModel):
    name: str = Field(min_length=1, max_length=80)


class CreatedWorkspaceOut(CamelModel):
    id: str
    name: str
    slug: str


@router.post("/instance/workspaces", response_model=CreatedWorkspaceOut, status_code=201)
async def create_workspace(
    payload: CreateWorkspaceInput,
    request: Request,
    admin: SessionUser = Depends(require_instance_admin),
) -> CreatedWorkspaceOut:
    """Make another workspace, owned by whoever made it.

    The creator gets an owner account in it carrying the password they already have —
    `services/workspaces` keeps one address to one password across every row, so a new
    workspace never means a new credential to remember or a prompt to set one.

    They are not added to anyone else's workspace by this, and nobody else is added to
    theirs. A workspace starts with exactly one person in it, which is what an invitation
    is for.
    """
    async with transaction() as (session, _):
        password_hash = await workspace_service.password_hash_for(session, admin.email)
        founded = await workspace_service.found(
            session,
            name=payload.name,
            email=admin.email,
            display_name=admin.display_name,
            password_hash=password_hash,
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "workspace.created",
            target_type="workspace",
            target_id=founded.workspace_id,
            metadata={"name": payload.name.strip(), "slug": founded.slug},
        )

    return CreatedWorkspaceOut(
        id=founded.workspace_id, name=payload.name.strip(), slug=founded.slug
    )


class PolicyOut(CamelModel):
    """A workspace's policy, and what the server permits regardless.

    Both halves are returned because a tick that does nothing is worse than no tick: if
    the operator has turned hosting off server-wide, the console has to say so rather
    than show an enabled switch whose value never reaches a guard.
    """

    workspace_id: str
    may_host_agents: bool
    may_use_private_endpoints: bool
    may_connect_socket_agents: bool
    denied_scopes: list[str]
    max_apps: int | None = None
    #: What the environment allows at all. Policy narrows this and can never widen it.
    server_allows_hosting: bool
    server_allows_private_endpoints: bool


class PolicyInput(CamelModel):
    """Every field optional: a PUT that sets one switch should not clear the others."""

    may_host_agents: bool | None = None
    may_use_private_endpoints: bool | None = None
    may_connect_socket_agents: bool | None = None
    denied_scopes: list[str] | None = None
    max_apps: int | None = Field(default=None, ge=0, le=1000)


def _policy_out(workspace_id: str, policy: policy_service.Policy) -> PolicyOut:
    return PolicyOut(
        workspace_id=workspace_id,
        may_host_agents=policy.may_host_agents,
        may_use_private_endpoints=policy.may_use_private_endpoints,
        may_connect_socket_agents=policy.may_connect_socket_agents,
        denied_scopes=sorted(policy.denied_scopes),
        max_apps=policy.max_apps,
        server_allows_hosting=settings.AGENT_RUNNER != "disabled",
        server_allows_private_endpoints=settings.AGENT_ALLOW_PRIVATE_ENDPOINTS,
    )


@router.get("/instance/workspaces/{workspace_id}/policy", response_model=PolicyOut)
async def read_policy(
    workspace_id: str, _admin: SessionUser = Depends(require_instance_admin)
) -> PolicyOut:
    """What is written down for this workspace — not what the guards compute.

    Deliberately `stored_for` rather than `effective_for`: the console edits the row, and
    showing it the environment-narrowed value would make a switch appear to turn itself
    off when the operator saved it.
    """
    async with session_scope() as session:
        return _policy_out(workspace_id, await policy_service.stored_for(session, workspace_id))


@router.put("/instance/workspaces/{workspace_id}/policy", response_model=PolicyOut)
async def write_policy(
    workspace_id: str,
    payload: PolicyInput,
    request: Request,
    admin: SessionUser = Depends(require_instance_admin),
) -> PolicyOut:
    """Set what a workspace may do to this machine.

    Instance admins only. There is no workspace-admin route to this table, and that is
    the point of the table existing separately from `workspace_settings`.
    """
    unknown = sorted(set(payload.denied_scopes or []) - set(SCOPES))
    if unknown:
        raise bad_request(f"Unknown scope: {', '.join(unknown)}.", code="unknown_scope")

    fields = payload.model_dump(exclude_none=True)
    async with transaction() as (session, _):
        policy = await policy_service.write(
            session, workspace_id=workspace_id, actor_id=admin.id, **fields
        )
        await audit_service.record(
            session,
            actor_for(request, admin),
            "workspace.policy_changed",
            target_type="workspace",
            target_id=workspace_id,
            metadata=fields,
        )
    return _policy_out(workspace_id, policy)


# ─── server logs ──────────────────────────────────────────────────────────────
# Health says whether the parts answer and the audit log says who did what. Neither says
# what went *wrong*, so until now the only account of a failure was the container's
# stdout — behind shell access to the host, gone after a restart, and split across
# processes on a box running more than one. See `lib/logbuf`.
class ServerLogEntry(CamelModel):
    at: str
    level: str
    logger: str
    message: str
    #: Traceback, when the record carried an exception.
    detail: str | None = None
    #: The endpoint being served, on records from the unhandled-error handler.
    path: str | None = None
    method: str | None = None


class ServerLogsOut(CamelModel):
    entries: list[ServerLogEntry]
    #: What the buffer holds at most, so the console can say the list is capped rather
    #: than implying it is the whole history.
    capacity: int


@router.get("/instance/logs", response_model=ServerLogsOut)
async def list_server_logs(
    level: str | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    _admin: SessionUser = Depends(require_instance_admin),
) -> ServerLogsOut:
    """Recent warnings and errors, newest first.

    Instance-scoped rather than workspace-scoped, and gated accordingly: a traceback is
    about the machine, and can easily name a channel or an address belonging to a
    workspace the reader is not in.
    """
    entries = await logbuf.read_logs(limit=limit, level=level.upper() if level else None)
    return ServerLogsOut(
        entries=[ServerLogEntry(**entry) for entry in entries],
        capacity=logbuf.MAX_ENTRIES,
    )


@router.delete("/instance/logs", response_model=OkOut)
async def clear_server_logs(
    request: Request, admin: SessionUser = Depends(require_instance_admin)
) -> OkOut:
    """Empty the buffer — "I have dealt with these", which is its only state.

    Audited, because it is the one action here that destroys evidence.
    """
    await logbuf.clear_logs()
    async with transaction() as (session, _):
        await audit_service.record(session, actor_for(request, admin), "server_logs.cleared")
    return OkOut()


__all__ = ["router"]
