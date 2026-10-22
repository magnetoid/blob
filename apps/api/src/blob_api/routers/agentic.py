"""Thread summaries and human/agent task orchestration."""

from __future__ import annotations

from functools import partial
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from ..db.engine import session_scope, transaction
from ..lib import llm
from ..lib.auth import SessionUser, current_user, require_admin
from ..lib.errors import bad_request, forbidden, not_found, thread_gone
from ..lib.ids import IdParam
from ..lib.rate_limit import consume
from ..plugins import decisions
from ..plugins import events as plugin_events
from ..realtime import hub
from ..schemas.base import CamelModel, OkOut
from ..schemas.models import AgentTask, ThreadSummary
from ..schemas.requests import CreateAgentTaskInput, UpdateAgentTaskInput
from ..services import agent_chains, agent_run_control, task_dispatch
from ..services import agent_runs as agent_run_service
from ..services import agentic as agentic_service
from ..services import audit as audit_service
from ..services import catchup as catchup_service
from ..services import channels as channel_service
from ..services import messages as message_service
from ..services import users as user_service
from ..services.audit import actor_for
from ..services.serialize import task_event

router = APIRouter(tags=["agentic"])


class ThreadSummaryOut(CamelModel):
    summary: ThreadSummary | None = None


class AgentTasksOut(CamelModel):
    tasks: list[AgentTask]


class AgentTaskOut(CamelModel):
    task: AgentTask


async def _root_message(message_id: str, user: SessionUser) -> tuple[str, str]:
    async with session_scope() as session:
        root = await message_service.load_for(
            session, user.id, message_id, allow_deleted=True, gone=thread_gone
        )
        return root.thread_root_id or root.id, root.channel_id


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
    # Read, then call the model with nothing held, then store: a transaction must never
    # wait on a provider. The keyword scan is free, so only a model call is metered.
    async with session_scope() as session:
        messages, names = await agentic_service.read_thread(session, thread_root_id)
    if llm.configured():
        await consume("summarize", user.id)
    payload, provider = await agentic_service.build_summary(
        messages, names=names, workspace_id=user.workspace_id, asked_by=user.id
    )
    async with transaction() as (session, _after):
        summary = await agentic_service.store_summary(
            session,
            workspace_id=user.workspace_id,
            channel_id=channel_id,
            thread_root_id=thread_root_id,
            created_by=user.id,
            provider=provider,
            payload=payload,
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

    async with transaction() as (session, after):
        # A task is a write into the channel, and an archived channel is read-only — the
        # one check this route skipped that every other write here makes.
        await channel_service.assert_channel_access(
            session, user.id, channel_id, require_writable=True
        )
        # Handed to an agent, the task is also a message from this person — the hand-off
        # that sets the agent going (ADR 0023) — so it is checked, and counted, as one.
        agent = (
            await task_dispatch.agent_for(
                session,
                workspace_id=user.workspace_id,
                channel_id=channel_id,
                actor_id=user.id,
                actor_role=user.role,
                assignee_user_id=payload.assignee_user_id,
            )
            if payload.assignee_user_id and payload.assignee_user_id != user.id
            else None
        )
        if agent is not None:
            await consume("send_message", user.id)
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
        if agent is not None:
            task = await task_dispatch.dispatch(
                session,
                after,
                task=task,
                agent=agent,
                actor_id=user.id,
                workspace_id=user.workspace_id,
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
                "dispatchMessageId": task.dispatch_message_id,
            },
        )
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="task.created",
            channel_id=channel_id,
            payload=task.model_dump(by_alias=True),
        )
        after.add(partial(hub.to_channel, channel_id, task_event(task)))
    return AgentTaskOut(task=task)


@router.patch("/api/tasks/{task_id}", response_model=AgentTaskOut)
async def update_task(
    task_id: IdParam,
    payload: UpdateAgentTaskInput,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> AgentTaskOut:
    async with transaction() as (session, after):
        # Locked: what this save does is decided from the task as it stands, and two saves
        # at once — the retry pressed in two tabs — must not both decide from the same
        # blocked row and both hand the task over.
        existing = await agentic_service.get_task(session, task_id, for_update=True)
        await channel_service.assert_channel_access(
            session, user.id, existing.channel_id, require_writable=True
        )
        if (
            user.role == "member"
            and existing.assignee_user_id not in (None, user.id)
            and existing.created_by != user.id
        ):
            raise forbidden("You can only update your own assigned agent tasks.")
        # Two saves are a hand-off (ADR 0023): the task changing hands to an agent, and an
        # agent's task moved back to in progress from to do or blocked — "work on it
        # again", the retry for one its run blocked or a person stopped. Not from done or
        # cancelled: reopening finished work is a person's decision about the task, and a
        # save carrying a stale status must not quietly set the agent going on it again.
        # Saving anything else about it, its priority or its outcome, sets nothing going.
        handed_to = (
            payload.assignee_user_id
            if payload.assignee_user_id not in (None, user.id, existing.assignee_user_id)
            else None
        )
        again = (
            handed_to is None
            and payload.status == "in_progress"
            and existing.status in ("todo", "blocked")
            and existing.assignee_kind == "bot"
            and existing.assignee_user_id is not None
            and payload.assignee_user_id in (None, existing.assignee_user_id)
        )
        agent = None
        if handed_to is not None or again:
            agent = await task_dispatch.agent_for(
                session,
                workspace_id=user.workspace_id,
                channel_id=existing.channel_id,
                actor_id=user.id,
                actor_role=user.role,
                assignee_user_id=handed_to or str(existing.assignee_user_id),
                handing_over=handed_to is not None,
            )
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
        # Handed over finished — reassigned and closed in one save — there is nothing to
        # set going.
        if agent is not None and task.status not in ("done", "cancelled"):
            await consume("send_message", user.id)
            task = await task_dispatch.dispatch(
                session,
                after,
                task=task,
                agent=agent,
                actor_id=user.id,
                workspace_id=user.workspace_id,
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
                "dispatchMessageId": task.dispatch_message_id,
            },
        )
        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="task.updated",
            channel_id=existing.channel_id,
            payload=task.model_dump(by_alias=True),
        )
        after.add(partial(hub.to_channel, existing.channel_id, task_event(task)))
    return AgentTaskOut(task=task)


@router.get("/api/tasks", response_model=AgentTasksOut)
async def list_tasks(
    assignee: str | None = None,
    status: Annotated[str | None, Query()] = None,
    user: SessionUser = Depends(current_user),
) -> AgentTasksOut:
    wanted_assignee = user.id if assignee == "me" else assignee
    async with session_scope() as session:
        tasks = await agentic_service.list_tasks_visible_to(
            session, user.id, user.workspace_id, assignee=wanted_assignee, status=status
        )
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


@router.get("/api/agent-runs", response_model=AgentRunsOut)
async def workspace_agent_runs(user: SessionUser = Depends(current_user)) -> AgentRunsOut:
    """The home dashboard's live strip: running, waiting, and today's tail.

    Channel listings stay the conversation's; this is the same wire shape folded
    across every room the caller can see, so a Stop on the home card is the
    same Stop as the one under the mention.
    """
    async with session_scope() as session:
        runs = await agent_run_service.views_for_member(
            session, workspace_id=user.workspace_id, user_id=user.id
        )
    return AgentRunsOut(runs=runs)


class PendingOut(CamelModel):
    #: Each: `run` (the run's view), `channelName`, `channelKind`, `personName` — whom it
    #: waits on — and `visible`: whether the viewer can read the room, without which the
    #: question and the note are left out of `run`.
    pending: list[dict[str, Any]]


@router.get("/api/admin/approvals", response_model=PendingOut)
async def pending_approvals(admin: SessionUser = Depends(require_admin)) -> PendingOut:
    """What agents are waiting on across the workspace: decisions nobody has made, and runs
    that said they would come back. An admin's page; a room's words only where they can
    read the room."""
    async with session_scope() as session:
        pending = await agent_run_service.pending_for_admin(
            session, workspace_id=admin.workspace_id, viewer_id=admin.id
        )
    return PendingOut(pending=pending)


class AgentRunHistoryOut(CamelModel):
    runs: list[dict[str, Any]]
    #: The id to pass as `before` for the page after this one; None at the oldest.
    next_before: str | None = None


@router.get("/api/agent-runs/history", response_model=AgentRunHistoryOut)
async def agent_run_history(
    channel_id: Annotated[IdParam | None, Query(alias="channelId")] = None,
    plugin_id: Annotated[IdParam | None, Query(alias="pluginId")] = None,
    agent_user_id: Annotated[IdParam | None, Query(alias="agentUserId")] = None,
    before: IdParam | None = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 30,
    user: SessionUser = Depends(current_user),
) -> AgentRunHistoryOut:
    """A conversation's runs, or one agent's, newest first and a page at a time.

    The conversation's own list (`/api/channels/{id}/agent-runs`) is what a view folds in
    on load — the live cards and the last hour. This is the history behind it, for a
    member asking what an agent has been doing here, or anywhere they can see. A private
    conversation they are not in answers 404, as it does everywhere; an agent's history
    simply leaves such rooms out. An agent is named by its app (`pluginId`) or by the
    member it is (`agentUserId`), which is how a client that talks to it knows it.
    """
    if channel_id is None and plugin_id is None and agent_user_id is None:
        raise bad_request("Say which conversation or which agent.", code="invalid_input")
    async with session_scope() as session:
        if channel_id is not None:
            await channel_service.assert_channel_access(session, user.id, channel_id)
        if agent_user_id is not None:
            plugin_id = await user_service.bot_plugin_of(session, user.workspace_id, agent_user_id)
            if plugin_id is None:
                raise not_found("There is no agent by that id.")
        runs = await agent_run_service.history(
            session,
            workspace_id=user.workspace_id,
            user_id=user.id,
            channel_id=channel_id,
            plugin_id=plugin_id,
            before=before,
            limit=limit + 1,
        )
    more = len(runs) > limit
    page = runs[:limit]
    return AgentRunHistoryOut(runs=page, next_before=page[-1]["id"] if more and page else None)


@router.post("/api/agent-runs/{run_id}/cancel", response_model=OkOut)
async def cancel_agent_run(
    run_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    """Stop an in-flight run — anyone who can see the channel may, and the hops it caused
    stop with it. `services/agent_run_control.py` holds the rule, shared with an
    assistant's `stop_run`."""
    await agent_run_control.stop(
        workspace_id=user.workspace_id,
        run_id=run_id,
        user_id=user.id,
        actor=actor_for(request, user),
    )
    return OkOut()


class AnswerInput(CamelModel):
    """An answer to the decision a run is waiting on, from a client that has the run
    rather than the message — the card, and Home.

    `choice` is the place of one of the choices the run's view offers (`decision.choices`),
    and Blob hands the agent the value the agent declared for it; `value` is words, for a
    question that asked for words. Exactly one. The buttons on the message itself go
    through `/api/interactions` like every other block; one service is behind both.
    """

    value: str | None = Field(default=None, min_length=1, max_length=2000)
    choice: int | None = Field(default=None, ge=0, le=99)
    client_action_id: str | None = Field(default=None, max_length=64)


@router.post("/api/agent-runs/{run_id}/answer", response_model=OkOut)
async def answer_agent_run(
    run_id: IdParam,
    payload: AnswerInput,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> OkOut:
    """Answer the question an agent stopped to ask, and let it carry on.

    Only the person the run is on behalf of may — the card is public, the decision is
    theirs. The answer is posted as their own message so the channel sees it as a
    decision, and the agent resumes with it. See `services/agent_chains.answer`.
    """
    if (payload.value is None) == (payload.choice is None):
        raise bad_request("Answer with a choice or with words.", code="invalid_input")
    await consume("send_message", user.id)
    async with transaction() as (session, after):
        answered = await agent_chains.answer(
            session,
            after,
            workspace_id=user.workspace_id,
            run_id=run_id,
            user_id=user.id,
            user_name=user.display_name,
            # A choice is answered as its button would be: by its place among the
            # choices the agent declared, which `payload_for` reads back to its value.
            action_id=(
                f"{decisions.ACTION_PREFIX}{run_id}:{payload.choice}"
                if payload.choice is not None
                else None
            ),
            value=payload.value or "",
            client_action_id=payload.client_action_id,
        )
        await audit_service.record(
            session,
            actor_for(request, user),
            "agent.run_answered",
            target_type="agent_run",
            target_id=run_id,
            metadata={"channelId": answered.channel_id},
        )
    return OkOut()
