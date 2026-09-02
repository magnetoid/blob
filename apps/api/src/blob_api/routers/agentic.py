"""Thread summaries and human/agent task orchestration."""

from __future__ import annotations

from contextlib import suppress
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import forbidden, not_found
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..lib.redis import redis
from ..plugins import events as plugin_events
from ..schemas.base import CamelModel
from ..schemas.models import AgentTask, ThreadSummary
from ..schemas.requests import CreateAgentTaskInput, UpdateAgentTaskInput
from ..services import agent_runs as agent_run_service
from ..services import agentic as agentic_service
from ..services import audit as audit_service
from ..services import catchup as catchup_service
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services.audit import actor_for
from ..services.serialize import to_agent_task

router = APIRouter(tags=["agentic"])


class ThreadSummaryOut(CamelModel):
    summary: ThreadSummary | None = None


class AgentTasksOut(CamelModel):
    tasks: list[AgentTask]


class AgentTaskOut(CamelModel):
    task: AgentTask


async def _root_message(message_id: str, user: SessionUser) -> tuple[str, str]:
    async with session_scope() as session:
        root = await message_service.by_id(session, message_id)
        if root is None:
            raise not_found("That thread no longer exists.")
        thread_root_id = root.thread_root_id or root.id
        await channel_service.assert_channel_access(session, user.id, root.channel_id)
        return thread_root_id, root.channel_id


@router.get("/api/threads/{message_id}/summary", response_model=ThreadSummaryOut)
async def get_thread_summary(
    message_id: IdParam, user: SessionUser = Depends(current_user)
) -> ThreadSummaryOut:
    thread_root_id, _channel_id = await _root_message(message_id, user)
    async with session_scope() as session:
        summary = await agentic_service.get_summary(session, thread_root_id)
    return ThreadSummaryOut(summary=summary)


@router.post("/api/threads/{message_id}/summary", response_model=ThreadSummaryOut)
async def refresh_thread_summary(
    message_id: IdParam,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> ThreadSummaryOut:
    thread_root_id, channel_id = await _root_message(message_id, user)
    async with transaction() as (session, _after):
        summary = await agentic_service.generate_summary(
            session,
            workspace_id=user.workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            created_by=user.id,
        )
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.summary_generated",
            target_type="message",
            target_id=thread_root_id,
            metadata={"channelId": channel_id, "provider": summary.provider},
        )
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="thread.summary.updated",
            channel_id=channel_id,
            payload=summary.model_dump(by_alias=True),
        )
    return ThreadSummaryOut(summary=summary)


@router.get("/api/threads/{message_id}/tasks", response_model=AgentTasksOut)
async def list_thread_tasks(
    message_id: IdParam, user: SessionUser = Depends(current_user)
) -> AgentTasksOut:
    thread_root_id, _channel_id = await _root_message(message_id, user)
    async with session_scope() as session:
        tasks = await agentic_service.list_tasks_for_thread(session, thread_root_id)
    return AgentTasksOut(tasks=tasks)


@router.post("/api/threads/{message_id}/tasks", response_model=AgentTaskOut, status_code=201)
async def create_thread_task(
    message_id: IdParam,
    payload: CreateAgentTaskInput,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> AgentTaskOut:
    thread_root_id, channel_id = await _root_message(message_id, user)
    if payload.assignee_user_id and payload.assignee_user_id != user.id and user.role == "member":
        async with session_scope() as session:
            assignee = (
                await session.execute(
                    text("SELECT kind FROM users WHERE id = :id AND workspace_id = :ws"),
                    {"id": payload.assignee_user_id, "ws": user.workspace_id},
                )
            ).fetchone()
        if assignee is not None and assignee.kind == "bot":
            raise forbidden("Only admins can assign work directly to an agent.")

    async with transaction() as (session, _after):
        task = await agentic_service.create_task(
            session,
            workspace_id=user.workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            created_by=user.id,
            assignee_user_id=payload.assignee_user_id,
            title=payload.title,
            instructions=payload.instructions,
            priority=payload.priority,
            due_at=payload.due_at,
            summary_id=payload.summary_id,
            external_ref=payload.external_ref,
        )
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.task_created",
            target_type="agent_task",
            target_id=task.id,
            metadata={
                "channelId": channel_id,
                "threadRootId": thread_root_id,
                "assigneeUserId": task.assignee_user_id,
                "priority": task.priority,
            },
        )
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="task.created",
            channel_id=channel_id,
            payload=task.model_dump(by_alias=True),
        )
    return AgentTaskOut(task=task)


@router.patch("/api/tasks/{task_id}", response_model=AgentTaskOut)
async def update_task(
    task_id: IdParam,
    payload: UpdateAgentTaskInput,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> AgentTaskOut:
    async with transaction() as (session, _after):
        existing = await agentic_service.get_task(session, task_id)
        await channel_service.assert_channel_access(session, user.id, existing.channel_id)
        if (
            user.role == "member"
            and existing.assignee_user_id not in (None, user.id)
            and existing.created_by != user.id
        ):
            raise forbidden("You can only update your own assigned agent tasks.")
        if (
            payload.assignee_user_id
            and payload.assignee_user_id != user.id
            and user.role == "member"
        ):
            assignee_row = (
                await session.execute(
                    text("SELECT kind FROM users WHERE id = :id AND workspace_id = :ws"),
                    {"id": payload.assignee_user_id, "ws": user.workspace_id},
                )
            ).fetchone()
            if assignee_row is not None and assignee_row.kind == "bot":
                raise forbidden("Only admins can reassign work to an agent.")
        task = await agentic_service.update_task(
            session,
            task_id=task_id,
            workspace_id=user.workspace_id,
            assignee_user_id=payload.assignee_user_id,
            status=payload.status,
            priority=payload.priority,
            due_at=payload.due_at,
            outcome=payload.outcome,
            instructions=payload.instructions,
        )
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.task_updated",
            target_type="agent_task",
            target_id=task.id,
            metadata={
                "status": task.status,
                "assigneeUserId": task.assignee_user_id,
                "priority": task.priority,
            },
        )
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="task.updated",
            channel_id=existing.channel_id,
            payload=task.model_dump(by_alias=True),
        )
    return AgentTaskOut(task=task)


@router.get("/api/tasks", response_model=AgentTasksOut)
async def list_tasks(
    assignee: str | None = None,
    status: Annotated[str | None, Query()] = None,
    user: SessionUser = Depends(current_user),
) -> AgentTasksOut:
    wanted_assignee = user.id if assignee == "me" else assignee
    async with session_scope() as session:
        # Visibility lives inside the statement, the same predicate the search query
        # uses: public channels, or ones the caller belongs to. The old shape called
        # `assert_channel_access` per row, which was one query per task — and, worse,
        # *raised* on the first task in a private channel the caller cannot see, so a
        # single foreign task 404'd the whole listing instead of being omitted.
        rows = (
            await session.execute(
                text(
                    """
                    SELECT t.*, u.kind AS assignee_kind
                      FROM agent_tasks t
                      LEFT JOIN users u ON u.id = t.assignee_user_id
                      JOIN channels c ON c.id = t.channel_id
                     WHERE t.workspace_id = :ws
                       AND (
                         c.kind = 'public'
                         OR EXISTS (
                           SELECT 1 FROM channel_members cm
                            WHERE cm.channel_id = c.id AND cm.user_id = :user_id
                         )
                       )
                       AND (
                         cast(:assignee AS uuid) IS NULL
                         OR t.assignee_user_id = cast(:assignee AS uuid)
                       )
                       AND (cast(:status AS text) IS NULL OR t.status = :status)
                     ORDER BY t.updated_at DESC, t.id DESC
                     LIMIT 200
                    """
                ),
                {
                    "ws": user.workspace_id,
                    "user_id": user.id,
                    "assignee": wanted_assignee,
                    "status": status,
                },
            )
        ).fetchall()
        tasks = [to_agent_task(row) for row in rows]
    return AgentTasksOut(tasks=tasks)


# ─── catch me up ─────────────────────────────────────────────────────────────


class CatchupInput(CamelModel):
    channel_id: str | None = None


class CatchupSummaryOut(CamelModel):
    channel_id: str
    channel_name: str | None
    text: str
    message_count: int
    up_to_message_id: IdParam


class CatchupOut(CamelModel):
    summaries: list[CatchupSummaryOut]


@router.post("/api/catchup", response_model=CatchupOut)
async def catch_me_up(
    payload: CatchupInput, user: SessionUser = Depends(current_user)
) -> CatchupOut:
    """Summarise what you haven't read — one channel, or the busiest few.

    Ephemeral by construction: the response is the whole artifact. Nothing is stored,
    nothing is broadcast, and posting a summary into the channel is the client
    sending it as you, through the ordinary idempotent send.
    """
    await consume("catchup", user.id)
    if payload.channel_id:
        async with session_scope() as session:
            await channel_service.assert_channel_access(session, user.id, payload.channel_id)
    async with session_scope() as session:
        summaries = await catchup_service.summarise(
            session,
            workspace_id=user.workspace_id,
            user_id=user.id,
            channel_id=payload.channel_id,
        )
    return CatchupOut(
        summaries=[
            CatchupSummaryOut(
                channel_id=s.channel_id,
                channel_name=s.channel_name,
                text=s.text,
                message_count=s.message_count,
                up_to_message_id=s.up_to_message_id,
            )
            for s in summaries
        ]
    )


# ─── agent runs, as the conversation sees them ───────────────────────────────


class AgentRunsOut(CamelModel):
    runs: list[dict[str, Any]]


class OkOut(CamelModel):
    ok: bool = True


@router.get("/api/channels/{channel_id}/agent-runs", response_model=AgentRunsOut)
async def channel_agent_runs(
    channel_id: IdParam, user: SessionUser = Depends(current_user)
) -> AgentRunsOut:
    """The runs a conversation renders on load: live cards plus the recent tail.

    The socket carries the same shapes while a run streams; this is what a reload —
    or a client that joined mid-run — folds in first.
    """
    async with session_scope() as session:
        await channel_service.assert_channel_access(session, user.id, channel_id)
        runs = await agent_run_service.views_for_channel(
            session, workspace_id=user.workspace_id, channel_id=channel_id
        )
    return AgentRunsOut(runs=runs)


@router.post("/api/agent-runs/{run_id}/cancel", response_model=OkOut)
async def cancel_agent_run(
    run_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Stop an in-flight run.

    Anyone who can see the channel can stop a run in it — the same rule as Slack's
    stop button, and the right one: the person paying attention is rarely the person
    who asked. The worker hears it two ways, key and publish, because it subscribes
    before it checks and a Stop pressed in the gap must land on one side or the other.
    """
    async with transaction() as (session, _):
        running = (
            await session.execute(
                text(
                    """
                    SELECT channel_id FROM agent_runs
                     WHERE id = :id AND workspace_id = :ws AND status = 'running'
                    """
                ),
                {"id": run_id, "ws": user.workspace_id},
            )
        ).fetchone()
        if running is None:
            # Finished, cancelled already, or another workspace's — all the same 404,
            # because which of those it is would answer questions the id holder has
            # no business asking.
            raise not_found("That run is not running.")
        # Access before the mark: a member who cannot see the channel must not be
        # able to stop what is happening in it — same 404, same reason.
        channel_id = str(running.channel_id)
        await channel_service.assert_channel_access(session, user.id, channel_id)
        marked = await agent_run_service.request_cancel(
            session, workspace_id=user.workspace_id, run_id=run_id
        )
        if marked is None:
            raise not_found("That run is not running.")

    with suppress(Exception):
        await redis.set(f"agui:cancel:{run_id}", user.id, nx=True, ex=600)
    with suppress(Exception):
        await redis.publish(f"agent:ctl:{run_id}", "cancel")

    async with transaction() as (session, _):
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.run_cancelled",
            target_type="agent_run",
            target_id=run_id,
            metadata={"channelId": marked["channelId"]},
        )
    return OkOut()
