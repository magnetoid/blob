"""One agent asking another, and getting the answer back.

An agent could already hand a question on: a reply that mentions another agent starts a
hop of the same chain (ADR 0013), on the authority of the person at the root. What it
could not do was *hear* the answer — the hop answered the room and the asking run had
long finished. `ask_agent`, offered to an agent with Blob's tools (ADR 0022), closes
that: the question is posted in the run's own conversation as the asking agent, exactly
the message a mention would have been, and the tool call waits for the hop's answer and
hands it back as the call's result.

Nothing about the hop is new, and that is the point. It is admitted by the chain's own
rules — depth budget, runs per chain, the per-agent cap that ends ping-pong, the
quarter-hour wall — and refused by them in the same silence; it runs on the root
person's authority; Stop on the asking run stops it; its answer lands in the
conversation for everyone, as every agent's does. What the asking agent gets is a copy.

What is waited on is bounded by the asking run's own wall clock, and never longer than
`ASK_WAIT_SEC`. Past that the call answers that the other agent is still working and
will answer in the conversation — the truth, and the agent can say so.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any

from sqlalchemy import text

from ..db.engine import session_scope
from ..lib.errors import AppError
from ..plugins.agui import ToolCall
from ..plugins.streams import Listener
from ..services import agent_runs as agent_run_service
from ..services import mcp as mcp_service
from ..services import task_dispatch
from .agui_tools import ToolOutcome

log = logging.getLogger("blob.jobs.agui")

#: The longest one call waits for the other agent, in seconds. Less than the run's own
#: ten-minute wall, so the asking agent still has time to use what it heard.
ASK_WAIT_SEC = 240.0
#: How long a hop has to appear at all. A hop the chain refuses never gets a run row;
#: this is how long it takes to be sure that is what happened.
NO_RUN_GRACE_SEC = 20.0
#: Kept back from the asking run's wall, so it can answer after hearing back.
RESERVE_SEC = 15.0
POLL_SEC = 1.0
#: A question is a message in the conversation; it is held to a message's measure.
MAX_QUESTION_CHARS = 4_000

#: How a finished hop ended, said to the agent that asked.
_ENDED = {
    "failed": "failed",
    "refused": "was refused",
    "expired": "ran out of time",
    "cancelled": "was stopped",
}


def question_key(run_id: str, call_id: str) -> str:
    """The question's idempotency key: one per call, so a repeated round asks nothing new.

    Not `agui:{run}:…`: that prefix is how `agent_runs.answer_of` finds what a run *said*,
    and a question this run asked is not part of its answer. The call id is the agent's
    own choosing, so it is hashed to a fixed width rather than stored as given.
    """
    digest = hashlib.sha256(call_id.encode()).hexdigest()[:16]
    return f"ask:{run_id}:{digest}"


async def ask(
    listener: Listener,
    call: ToolCall,
    *,
    caller: mcp_service.McpCaller,
    workspace_id: str,
    channel_id: str,
    thread_root_id: str | None,
    run_id: str,
    may_spawn: bool,
    deadline: float,
) -> ToolOutcome:
    """Ask the named agent in this run's conversation, and wait for its answer.

    Never raises: every way this can end is something the asking agent can act on.
    """
    arguments = call.parsed_arguments()
    if arguments is None:
        return ToolOutcome("", "The arguments were not a JSON object.")
    reference, question = arguments.get("agent"), arguments.get("text")
    if not isinstance(reference, str) or not reference.strip():
        return ToolOutcome("", "`agent` is required: the name of the agent to ask.")
    if not isinstance(question, str) or not question.strip():
        return ToolOutcome("", "`text` is required: what to ask it.")
    if len(question) > MAX_QUESTION_CHARS:
        return ToolOutcome("", f"A question is at most {MAX_QUESTION_CHARS} characters.")
    if not may_spawn:
        # Said before anything is posted: a question the chain would refuse in silence
        # would otherwise sit in the room with nobody coming to answer it.
        return ToolOutcome(
            "",
            "This conversation's chain of agents is as long as the workspace allows; "
            "answer from what you have.",
        )

    try:
        async with session_scope() as session:
            bot_id = await mcp_service.person_id(session, caller, reference)
            agent = await task_dispatch.agent_for(
                session,
                workspace_id=workspace_id,
                channel_id=channel_id,
                actor_id=caller.user_id,
                actor_role=caller.role,
                assignee_user_id=bot_id,
                handing_over=False,
            )
    except AppError as error:
        return ToolOutcome("", error.message)
    if agent is None:
        return ToolOutcome("", f"“{reference.strip()}” is not an agent you can ask here.")
    if agent.bot_user_id == listener.bot_user_id:
        return ToolOutcome("", "That is you. Answer it yourself.")

    if time.monotonic() + NO_RUN_GRACE_SEC >= deadline - RESERVE_SEC:
        return ToolOutcome("", "There is not enough of this run left to wait for an answer.")

    # Imported here: `agui_outcome` imports this module for the tool round.
    from .agui_outcome import post_as_bot

    key = question_key(run_id, call.id)
    message_id = await post_as_bot(
        listener,
        workspace_id=workspace_id,
        channel_id=channel_id,
        thread_root_id=thread_root_id,
        body=f"@{agent.name} {question.strip()}",
        client_msg_id=key,
        blocks=None,
        run_id=run_id,
        spawn=True,
        mention_user_ids=[agent.bot_user_id],
    )
    if message_id is None:
        # A repeat of this round: the question is already in the room; wait on it.
        message_id = await _question_already_asked(listener, channel_id, key)
        if message_id is None:
            return ToolOutcome("", "The question could not be asked; try again.")

    return await _wait_for_answer(
        workspace_id=workspace_id,
        run_id=run_id,
        message_id=message_id,
        plugin_id=agent.plugin_id,
        name=agent.name,
        until=min(deadline - RESERVE_SEC, time.monotonic() + ASK_WAIT_SEC),
    )


async def _question_already_asked(listener: Listener, channel_id: str, key: str) -> str | None:
    async with session_scope() as session:
        found = (
            await session.execute(
                text(
                    """
                    SELECT id FROM messages
                     WHERE channel_id = :channel AND author_id = :bot
                       AND client_msg_id = :key
                    """
                ),
                {"channel": channel_id, "bot": listener.bot_user_id, "key": key},
            )
        ).scalar_one_or_none()
    return str(found) if found else None


async def _wait_for_answer(
    *,
    workspace_id: str,
    run_id: str,
    message_id: str,
    plugin_id: str,
    name: str,
    until: float,
) -> ToolOutcome:
    began = time.monotonic()
    while True:
        async with session_scope() as session:
            stopped = (
                await session.execute(
                    text("SELECT cancel_requested_at IS NOT NULL FROM agent_runs WHERE id = :id"),
                    {"id": run_id},
                )
            ).scalar_one_or_none()
            views = await agent_run_service.views_for_trigger(
                session, workspace_id=workspace_id, message_id=message_id
            )
            hop = next((view for view in views if view["pluginId"] == plugin_id), None)
            answer = (
                await agent_run_service.answer_of(session, str(hop["id"]))
                if hop is not None and hop["status"] == "succeeded"
                else []
            )
        if stopped:
            return ToolOutcome("", "This run was stopped while it waited.")
        if hop is not None:
            told = _told(hop, answer, name)
            if told is not None:
                return told
        elif time.monotonic() - began >= NO_RUN_GRACE_SEC:
            return ToolOutcome(
                "",
                f"{name} did not start: the workspace's limits on agents asking agents "
                "stopped it, or it is over its budget for today.",
            )
        if time.monotonic() >= until:
            return ToolOutcome(
                f"{name} is still working on it. Its answer will appear in this "
                "conversation when it is done; say so rather than guessing at it."
            )
        await asyncio.sleep(POLL_SEC)


def _told(hop: dict[str, Any], answer: list[str], name: str) -> ToolOutcome | None:
    """What the asking agent is told about a hop, or None while it is still running."""
    status = str(hop["status"])
    if status == "running":
        return None
    if status == "succeeded":
        if not answer:
            return ToolOutcome(f"{name} finished without saying anything.")
        return ToolOutcome(f"{name} answered:\n\n" + "\n\n".join(answer))
    if status == "interrupted":
        decision = hop.get("decision") or {}
        prompt = decision.get("prompt") or "a question"
        return ToolOutcome(
            f"{name} stopped to ask the person this runs for: {prompt}. It will carry on "
            "in this conversation once they answer."
        )
    why = hop.get("error")
    ended = _ENDED.get(status, status)
    return ToolOutcome("", f"{name}'s run {ended}" + (f": {why}" if why else "."))


__all__ = ["ASK_WAIT_SEC", "NO_RUN_GRACE_SEC", "ask", "question_key"]
