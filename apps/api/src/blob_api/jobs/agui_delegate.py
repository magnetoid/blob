"""One agent asking another, and getting the answer back.

An agent could already hand a question on: a reply that mentions another agent starts a
hop of the same chain (ADR 0013), on the authority of the person at the root. What it
could not do was *hear* the answer — the hop answered the room and the asking run had
long finished. `ask_agent`, offered to an agent with Blob's tools (ADR 0022), closes
that: the question is posted in the run's own conversation as the asking agent, exactly
the message a mention would have been, and the hop's answer comes back as the call's
result.

Nothing about the hop is new, and that is the point. It is admitted by the chain's own
rules — depth budget, runs per chain, the per-agent cap that ends ping-pong, the
quarter-hour wall — and refused by them in the same silence; it runs on the root
person's authority; Stop on the asking run stops it; its answer lands in the
conversation for everyone, as every agent's does. What the asking agent gets is a copy.

**The asking run waits without holding anything (M2 · A2).** It used to wait inside its
own job, holding a worker slot for up to three minutes, so only half the slots could
wait and a slow answer was "still working". Now the run posts the question and ends its
round in `waiting`, keeping its tool exchange the way a run waiting on a person's
approval keeps it; when the other agent stops — answered, failed, refused, or asked a
person something — its finish enqueues `agent_heard` for the waiting run, which carries
on as a resume with what came back as the call's result (`jobs/agui.handle_agent_heard`).
A cron is the net under that call: a hop that finished a moment before its asker began
waiting, a hop the chain never started, and a wait past the chain's own quarter hour.
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import asdict, dataclass
from typing import Any

from sqlalchemy import text

from ..db.engine import session_scope
from ..lib.errors import AppError
from ..plugins.agui import ToolCall
from ..plugins.streams import Listener
from ..services import agent_chains, task_dispatch
from ..services import agent_runs as agent_run_service
from ..services import mcp as mcp_service
from .agui_tools import ToolOutcome

#: How long a hop has to appear at all before the asking run is told it has not
#: started. A hop the chain turns away never gets a run row, but neither does one still
#: queued behind other work, so this is generous.
NO_RUN_GRACE_SEC = 60.0
#: The longest a run waits on another agent: the chain's own wall. Past it the asking run
#: is told the other agent is still working, and its answer will land in the room.
WAIT_LIMIT_SEC = float(agent_chains.CHAIN_MAX_SEC)
#: A question is a message in the conversation; it is held to a message's measure.
MAX_QUESTION_CHARS = 4_000

#: How a finished hop ended, said to the agent that asked.
_ENDED = {
    "failed": "failed",
    "refused": "was refused",
    "expired": "ran out of time",
    "cancelled": "was stopped",
}


@dataclass(frozen=True, slots=True)
class Asked:
    """A question posted and not yet answered: what a waiting run keeps of it, so the
    other agent's finish can find it and the resume can name who answered."""

    message_id: str
    plugin_id: str
    bot_user_id: str
    name: str

    def as_dict(self) -> dict[str, str]:
        return asdict(self)


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
) -> ToolOutcome | Asked:
    """Ask the named agent in this run's conversation. Answers what was asked — the run
    then waits for it, holding nothing — or, for a question that cannot be asked, why.

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
    return Asked(
        message_id=message_id,
        plugin_id=agent.plugin_id,
        bot_user_id=agent.bot_user_id,
        name=agent.name,
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


async def heard(session: Any, waiting: Any) -> ToolOutcome | None:
    """What a run waiting on another agent is told now, or None while there is nothing
    to tell it yet. `waiting` is its row: `interrupt.asked` names the question and the
    agent, `finished_at` is when it began to wait.

    The hop is the newest run of that agent on that question: a hop that itself waited
    and was carried on keeps its question as its trigger, so its continuation is found the
    same way, and a hop just carried on whose continuation has not started yet is no
    answer at all.
    """
    stored: dict[str, Any] = waiting.interrupt if isinstance(waiting.interrupt, dict) else {}
    raw_asked = stored.get("asked")
    asked: dict[str, Any] = raw_asked if isinstance(raw_asked, dict) else {}
    question, plugin_id = asked.get("message_id"), asked.get("plugin_id")
    name = str(asked.get("name") or "The other agent")
    if not question or not plugin_id:
        return ToolOutcome("", "The question this run asked could not be found again.")
    waited = time.time() - waiting.finished_at.timestamp() if waiting.finished_at else 0.0
    hops = [
        view
        for view in await agent_run_service.views_for_trigger(
            session, workspace_id=str(waiting.workspace_id), message_id=str(question)
        )
        if view["pluginId"] == str(plugin_id)
    ]
    hop = hops[-1] if hops else None
    if hop is None:
        if waited < NO_RUN_GRACE_SEC:
            return None
        # Not "it was refused": a hop the chain turns away leaves no run, but so does
        # one still queued behind other work, and the two cannot be told apart here.
        return ToolOutcome(
            "",
            f"{name} has not started. It may still be queued behind other work, or the "
            "workspace's limits on agents asking agents — or its budget for today — "
            "stopped it. If it runs, it will answer in this conversation.",
        )
    still_going = hop["status"] in ("running", "waiting") or (
        hop["status"] == "succeeded" and hop.get("answeredAt") is not None
    )
    if still_going:
        if waited < WAIT_LIMIT_SEC:
            return None
        return ToolOutcome(
            f"{name} is still working on it. Its answer will appear in this "
            "conversation when it is done; say so rather than guessing at it."
        )
    answer = (
        await agent_run_service.answer_of(session, str(hop["id"]))
        if hop["status"] == "succeeded"
        else []
    )
    return _told(hop, answer, name)


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


__all__ = ["NO_RUN_GRACE_SEC", "WAIT_LIMIT_SEC", "Asked", "ask", "heard", "question_key"]
