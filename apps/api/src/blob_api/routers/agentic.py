"""Thread summaries and human/agent task orchestration."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import forbidden, not_found
from ..plugins import events as plugin_events
from ..schemas.base import CamelModel
from ..schemas.models import AgentTask, ThreadSummary
from ..schemas.requests import CreateAgentTaskInput, UpdateAgentTaskInput
from ..services import agentic as agentic_service
from ..services import audit as audit_service
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
    message_id: str, user: SessionUser = Depends(current_user)
) -> ThreadSummaryOut:
    thread_root_id, _channel_id = await _root_message(message_id, user)
    async with session_scope() as session:
        summary = await agentic_service.get_summary(session, thread_root_id)
    return ThreadSummaryOut(summary=summary)


@router.post("/api/threads/{message_id}/summary", response_model=ThreadSummaryOut)
async def refresh_thread_summary(
    message_id: str,
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
    message_id: str, user: SessionUser = Depends(current_user)
) -> AgentTasksOut:
    thread_root_id, _channel_id = await _root_message(message_id, user)
    async with session_scope() as session:
        tasks = await agentic_service.list_tasks_for_thread(session, thread_root_id)
    return AgentTasksOut(tasks=tasks)


@router.post("/api/threads/{message_id}/tasks", response_model=AgentTaskOut, status_code=201)
async def create_thread_task(
    message_id: str,
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
            payload=task.model_dump(by_alias=True),
        )
    return AgentTaskOut(task=task)


@router.patch("/api/tasks/{task_id}", response_model=AgentTaskOut)
async def update_task(
    task_id: str,
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
        rows = (
            await session.execute(
                text(
                    """
                    SELECT t.*, u.kind AS assignee_kind
                      FROM agent_tasks t
                      LEFT JOIN users u ON u.id = t.assignee_user_id
                     WHERE t.workspace_id = :ws
                       AND (
                         cast(:assignee AS uuid) IS NULL
                         OR t.assignee_user_id = cast(:assignee AS uuid)
                       )
                       AND (cast(:status AS text) IS NULL OR t.status = :status)
                     ORDER BY t.updated_at DESC, t.id DESC
                    """
                ),
                {"ws": user.workspace_id, "assignee": wanted_assignee, "status": status},
            )
        ).fetchall()
        tasks: list[AgentTask] = []
        for row in rows:
            await channel_service.assert_channel_access(session, user.id, row.channel_id)
            tasks.append(to_agent_task(row))
    return AgentTasksOut(tasks=tasks)
