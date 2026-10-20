"""Handing a task to an agent, and hearing how it went (ADR 0023).

A task assigned to a person is a row and a notification. A task assigned to an agent used
to be the same row and nothing else: the agent was never told, so the work sat there until
somebody mentioned the agent — the very thing assigning it was meant to replace.

Now the assignment *is* the mention. It posts a hand-off in the task's thread, from the
person who assigned it, addressed to the agent, and that message takes the ordinary path:
it roots a chain on that person's authority (ADR 0013), the agent answers under it, Stop
and the run card work as they do for any mention, and the room can see who asked for
what. Nothing about running an agent is new here; only the trigger is composed rather
than typed.

The run is handed the task as a `context` item, and how the run ends moves the task: an
answer marks it done with the answer as its outcome, a failure or a refusal blocks it with
the reason, Stop puts it back to do, and a question the agent stops to ask leaves it in
progress until somebody answers. Only a task still in progress, still with that agent and
still on that hand-off is moved, so a run finishing behind a person's own decision never
overwrites it.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import partial
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import AppError, bad_request, forbidden
from ..lib.ids import new_id
from ..plugins import events as plugin_events
from ..plugins.registry import MENTIONABLE_AGENT
from ..realtime import hub
from ..schemas.base import iso
from ..schemas.models import AgentTask
from . import agent_access, workspace_settings
from . import agentic as agentic_service
from . import channels as channel_service
from . import messages as message_service
from .serialize import task_event

#: How much of the agent's answer the task keeps as its outcome. The whole answer is in
#: the thread, under the hand-off; the outcome is what a list of tasks shows of it.
OUTCOME_MAX_CHARS = 2_000


@dataclass(frozen=True, slots=True)
class Agent:
    """An agent a task is being handed to."""

    bot_user_id: str
    plugin_id: str
    #: The bot's display name: what the hand-off addresses and the outcome names.
    name: str


async def agent_for(
    session: AsyncSession,
    *,
    workspace_id: str,
    channel_id: str,
    actor_id: str,
    actor_role: str,
    assignee_user_id: str,
    handing_over: bool = True,
) -> Agent | None:
    """The agent behind this assignee, cleared to be handed work here — None for a person.

    Raises for an assignment that cannot be made, with the reason, before anything is
    written. These are the rules a mention meets, asked up front: a mention that breaks
    one is dropped in silence, because the room can see nothing happened, but somebody
    who picked an agent from a list is owed the reason it cannot take the task.

    - It must be an agent the person may command here (`agent_access.MAY_COMMAND`, ADR
      0018) — the workspace's, theirs, or lent to them. This replaces "only admins may
      assign work to an agent", which predates agents having owners: a member who may
      set an agent going with a mention may hand it a task, and an admin may not command
      somebody's own agent by assigning it work any more than by mentioning it.
    - The hand-off is the person's own message, so they must be able to post here.
    - The agent's bot must be in the channel, or it could never answer.
    - It must be switched on and able to post, and agents must be on for the workspace,
      or the task would wait for ever. (Switched off after the hand-off, the run is
      refused and the task blocked with the reason, which is the same rule arriving late.)

    An app's bot that is not an agent keeps the rule it had: an admin may assign it work,
    and the app hears of it through the task events, as it hears of every task. There is
    no run to start for it. `handing_over` is False when the task already sits with this
    assignee and is only being set going again, which assigns nothing — so that rule does
    not apply, and an app's bot is simply not an agent to set going.
    """
    row = (
        await session.execute(
            text(
                f"""
                SELECT u.id AS bot_user_id, u.kind, u.display_name, u.deactivated_at,
                       p.id AS plugin_id,
                       ({MENTIONABLE_AGENT}) AS is_agent,
                       ({agent_access.MAY_COMMAND}) AS may_command,
                       (p.status = 'enabled' AND EXISTS (
                          SELECT 1 FROM plugin_grants g
                           WHERE g.plugin_id = p.id AND g.scope = 'messages:write'
                       )) AS answers
                  FROM users u
                  LEFT JOIN plugins p ON p.id = u.bot_plugin_id
                 WHERE u.id = :assignee AND u.workspace_id = :ws
                """
            ),
            {
                "assignee": assignee_user_id,
                "ws": workspace_id,
                "actor_id": actor_id,
                "channel_id": channel_id,
            },
        )
    ).fetchone()
    # A person, somebody gone, or nobody at all: `create_task` and `update_task` say
    # which, with the messages they always had.
    if row is None or row.kind != "bot" or row.deactivated_at is not None:
        return None
    if row.plugin_id is None or not row.is_agent:
        if handing_over and actor_role == "member":
            raise forbidden("Only admins can assign work directly to an agent.")
        return None

    name = row.display_name
    if not row.may_command:
        raise forbidden(f"{name} isn't yours to hand work to here.")
    if not row.answers:
        raise bad_request(f"{name} is switched off.", code="agent_unavailable")
    stored = (
        await session.execute(
            text("SELECT settings FROM workspace_settings WHERE workspace_id = :ws"),
            {"ws": workspace_id},
        )
    ).fetchone()
    if not workspace_settings.parse(stored.settings if stored else None).agents_enabled:
        raise bad_request("Agents are turned off for this server.", code="agents_disabled")
    # The person first: an archived channel is "read-only" for both, and that is the
    # truer sentence than "the agent isn't here".
    await channel_service.assert_channel_access(
        session, actor_id, channel_id, require_member=True, require_writable=True
    )
    try:
        await channel_service.assert_channel_access(
            session, str(row.bot_user_id), channel_id, require_member=True, require_writable=True
        )
    except AppError:
        raise bad_request(
            f"{name} isn't in this channel. Add it here first.", code="agent_not_in_channel"
        ) from None
    return Agent(bot_user_id=str(row.bot_user_id), plugin_id=str(row.plugin_id), name=name)


def handoff_body(agent_name: str, title: str, instructions: str) -> str:
    """The hand-off as the room reads it: addressed to the agent, the task in bold.

    The dash ends the name for the mention parser, so a title that begins with a word is
    never read as part of a longer name — though the message's mentions are set outright
    anyway (`message_service.send`'s `mention_user_ids`).
    """
    head = f"@{agent_name} — a task for you: **{title.strip()}**"
    detail = instructions.strip()
    return f"{head}\n\n{detail}" if detail else head


async def dispatch(
    session: AsyncSession,
    after: Any,
    *,
    task: AgentTask,
    agent: Agent,
    actor_id: str,
    workspace_id: str,
) -> AgentTask:
    """Post the hand-off as the person who assigned the task, and mark it in progress.

    Inside the caller's transaction, so the task and its hand-off commit together; the run
    is enqueued past COMMIT by `announce`, like any message's. The message mentions the
    agent and nobody else, whatever the task's text names.
    """
    result = await message_service.send(
        session,
        workspace_id=workspace_id,
        channel_id=task.channel_id,
        author_id=actor_id,
        body=handoff_body(agent.name, task.title, task.instructions),
        # Unique per hand-off: a task handed back to an agent it had before is a new
        # message, not the old one found again by its key.
        client_msg_id=f"task:{task.id}:{new_id()}",
        thread_root_id=task.thread_root_id,
        mention_user_ids=[agent.bot_user_id],
    )
    await message_service.announce(
        session, after, result, workspace_id=workspace_id, channel_id=task.channel_id
    )
    await session.execute(
        text(
            """
            UPDATE agent_tasks
               SET status = 'in_progress', dispatch_message_id = :message_id,
                   completed_at = NULL, updated_at = now()
             WHERE id = :id
            """
        ),
        {"id": task.id, "message_id": result.message.id},
    )
    return await agentic_service.get_task(session, task.id)


async def for_run(
    session: AsyncSession, *, chain_id: str, bot_user_id: str
) -> dict[str, Any] | None:
    """The task a run is working on, as the run is told it — or None, for nearly all runs.

    Found by the chain: a run on a hand-off's chain, by the agent it was handed to, is that
    task's run — the first one, and every resume after a question it asked.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT id, title, instructions, priority, due_at
                  FROM agent_tasks
                 WHERE dispatch_message_id = :chain_id
                   AND assignee_user_id = :bot_user_id
                   AND status NOT IN ('done', 'cancelled')
                """
            ),
            {"chain_id": chain_id, "bot_user_id": bot_user_id},
        )
    ).fetchone()
    if row is None:
        return None
    return {
        "id": str(row.id),
        "title": row.title,
        "instructions": row.instructions,
        "priority": row.priority,
        "dueAt": iso(row.due_at),
    }


def _clip(said: str) -> str:
    if len(said) <= OUTCOME_MAX_CHARS:
        return said
    return said[: OUTCOME_MAX_CHARS - 1].rstrip() + "…"


def outcome_of(
    status: str, agent: str, *, reason: str | None, answer: str | None
) -> tuple[str, str | None]:
    """Where a run's ending leaves its task: the task's next status, and its outcome.

    None for the outcome leaves the one it had. Done needs an answer: a run that ended
    cleanly having said nothing has not handed anything back, and calling that done would
    tell the person who assigned it that the work is finished when nothing came.
    """
    if status == "succeeded":
        said = (answer or "").strip()
        if said:
            return "done", _clip(said)
        return "blocked", f"{agent} finished without answering."
    if status == "cancelled":
        # Somebody pressed Stop: not being worked on, not broken either.
        return "todo", None
    if status == "expired":
        return "blocked", f"Nobody answered {agent}'s question in time."
    if status == "refused":
        return "blocked", f"{agent} did not run: {reason or 'it was refused.'}"
    return "blocked", f"{agent} could not finish: {reason or 'the run failed.'}"


async def settle(
    session: AsyncSession,
    after: Any,
    *,
    chain_id: str,
    plugin_id: str,
    status: str,
    reason: str | None = None,
    answer: str | None = None,
) -> AgentTask | None:
    """Move the task a run was handed by how the run ended — inside the transaction that
    records the ending, so the run and its task never disagree.

    A no-op for every run that was not handed a task, which is one read of a partial
    index. A run that stopped to ask leaves its task in progress: the question is in the
    thread, and the resume that follows the answer settles it — as does one waiting on
    another agent's answer (M2 · A2).
    """
    if status in ("interrupted", "running", "waiting"):
        return None
    row = (
        await session.execute(
            text(
                """
                SELECT t.id, t.workspace_id, p.name
                  FROM agent_tasks t
                  JOIN users u ON u.id = t.assignee_user_id
                  JOIN plugins p ON p.id = u.bot_plugin_id
                 WHERE t.dispatch_message_id = :chain_id
                   AND p.id = :plugin_id
                   AND t.status = 'in_progress'
                 FOR UPDATE OF t
                """
            ),
            {"chain_id": chain_id, "plugin_id": plugin_id},
        )
    ).fetchone()
    if row is None:
        return None
    next_status, outcome = outcome_of(status, row.name, reason=reason, answer=answer)
    await session.execute(
        text(
            """
            UPDATE agent_tasks
               SET status = :status,
                   outcome = COALESCE(:outcome, outcome),
                   completed_at = CASE WHEN :done THEN now() END,
                   updated_at = now()
             WHERE id = :id
            """
        ),
        {"id": row.id, "status": next_status, "outcome": outcome, "done": next_status == "done"},
    )
    task = await agentic_service.get_task(session, str(row.id))
    await plugin_events.emit(
        session,
        workspace_id=str(row.workspace_id),
        event="task.updated",
        channel_id=task.channel_id,
        payload=task.model_dump(by_alias=True),
    )
    after.add(partial(hub.to_channel, task.channel_id, task_event(task)))
    return task
