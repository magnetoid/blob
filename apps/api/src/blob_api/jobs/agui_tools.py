"""Blob's tools, in an agent's hands (ADR 0022).

An agent answering a mention may be offered Blob's own tools — the ones a person's
assistant reaches over `/api/mcp` (`services/mcp_catalogue.py`), with the same names,
schemas and executors. AG-UI carries them as client-executed tools: Blob lists them in
`RunAgentInput.tools`, the agent calls one by streaming the call and stopping, and Blob
runs it and continues the run with the result as a `tool` message. Nothing new is held by
the agent; Blob decides every call.

Three rules make that safe to offer, and this module is where they are kept:

- **The asker's authority.** Every call runs as the person the chain runs on — an
  `McpCaller` for them, so every read meets the same `assert_channel_access` their
  browser does.
- **Inside the room.** That caller carries the room the agent was asked in
  (`room_channel_id`), so in a channel the agent reads public channels and that room and
  nothing else; only in its own DM with the person does it get their whole reach.
- **Writes ask first.** A write is never run when the agent asks for it. It is checked
  (`prepare_write`) and put to the person as a question; only their Approve runs it
  (`run_write`), as the agent's bot, where that bot may post.

What a tool says back is data: it reaches the agent as a `tool` message and nowhere else.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text

from ..db.engine import session_scope
from ..lib.errors import AppError
from ..lib.ids import new_id
from ..plugins.agui import ToolCall
from ..services import channels as channel_service
from ..services import mcp as mcp_service
from ..services import mcp_catalogue

log = logging.getLogger("blob.jobs.agui")

_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")

#: What an admin may let an agent do (`plugins.tool_access`, migration 0047).
ACCESS_LEVELS = ("none", "read", "write")

#: The tools an agent may read with. `whoami` is the assistant's — it describes a token —
#: and is not offered: an agent's identity is its bot, and the person is in the context.
READ_TOOLS = ("list_channels", "read_channel", "read_thread", "search_messages", "list_people")
#: The tools that act. Each call waits for the person's approval.
WRITE_TOOLS = ("post_message",)

#: Rounds of tool calls one run may make, and calls in one round. A run that keeps
#: calling past them is not converging on an answer.
MAX_TOOL_ROUNDS = 8
MAX_CALLS_PER_ROUND = 8

#: What one result may hand the agent, in characters. A channel's morning, not its year.
RESULT_MAX_CHARS = 24_000
#: How much of the exchange so far an approval keeps while it waits, in characters of
#: tool results. Past it, the oldest results are stood down to a line saying so.
EXCHANGE_MAX_CHARS = 200_000

#: How an agent is told what `post_message` does, which is not what an assistant is told:
#: it posts as the agent, and only once the person says yes.
_FOR_AGENTS = {
    "post_message": (
        "Post a message to a channel or a thread, as yourself. The person you are working "
        "for is asked to approve it first, and you are told whether they did. Say what it "
        "is: everyone in the channel will read it."
    ),
}


def offered_names(access: str) -> frozenset[str]:
    """The tools an agent with this access is offered."""
    if access == "read":
        return frozenset(READ_TOOLS)
    if access == "write":
        return frozenset(READ_TOOLS + WRITE_TOOLS)
    return frozenset()


def offered(access: str) -> list[dict[str, Any]]:
    """The tools as `RunAgentInput.tools` carries them: name, description, parameters.

    In the catalogue's order, so a model's prompt cache sees the same list every run.
    """
    return offered_for(offered_names(access))


#: Parameters an agent is not offered. Blob keys an agent's post by the call that made it
#: (`run_write`), so an id of the agent's own would be one more thing to get wrong and
#: would change nothing.
_NOT_FOR_AGENTS: dict[str, frozenset[str]] = {"post_message": frozenset({"client_msg_id"})}


def _parameters(tool: dict[str, Any]) -> dict[str, Any]:
    hidden = _NOT_FOR_AGENTS.get(tool["name"])
    schema: dict[str, Any] = tool["inputSchema"]
    if not hidden:
        return schema
    return {
        **schema,
        "properties": {k: v for k, v in schema["properties"].items() if k not in hidden},
    }


def offered_for(names: frozenset[str]) -> list[dict[str, Any]]:
    """`offered`, for a set of names already decided."""
    return [
        {
            "name": tool["name"],
            "description": _FOR_AGENTS.get(tool["name"], tool["description"]),
            "parameters": _parameters(tool),
        }
        for tool in mcp_catalogue.CATALOGUE
        if tool["name"] in names
    ]


@dataclass(slots=True)
class ToolOutcome:
    """What a call produced: text for the agent, or an error it can act on."""

    content: str
    error: str | None = None
    #: The error was Blob's, not a refusal: something broke inside the tool. Counted
    #: apart (`blob_tool_calls_total`), since one is working as intended and one is a bug.
    failed: bool = False

    @property
    def summary(self) -> str:
        """One line for the run card, which the whole channel reads."""
        text_ = self.error or self.content
        first = text_.strip().splitlines()[0] if text_.strip() else ""
        return f"error: {first}" if self.error else first


@dataclass(slots=True)
class PreparedWrite:
    """A post the agent asked for, checked and waiting for the person."""

    channel_id: str
    label: str
    text: str
    thread_root_id: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "channelId": self.channel_id,
            "label": self.label,
            "text": self.text,
            "threadRootId": self.thread_root_id,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> PreparedWrite | None:
        channel_id, label, body = raw.get("channelId"), raw.get("label"), raw.get("text")
        if not all(isinstance(v, str) and v for v in (channel_id, label, body)):
            return None
        root = raw.get("threadRootId")
        return cls(
            channel_id=str(channel_id),
            label=str(label),
            text=str(body),
            thread_root_id=root if isinstance(root, str) and root else None,
        )


async def room_for(*, channel_id: str, bot_user_id: str, person_id: str) -> str | None:
    """The room an agent's reads are bounded to, or None for the person's whole reach.

    None only in the agent's own DM with the person: two members, exactly the bot and
    them. There the room *is* the person and nobody else reads the answer. Anywhere else
    — a channel, a group DM, a DM that is somebody else's — the room is the bound.
    """
    async with session_scope() as session:
        members = {
            str(row.user_id)
            for row in (
                await session.execute(
                    text(
                        """
                        SELECT cm.user_id FROM channel_members cm
                          JOIN channels c ON c.id = cm.channel_id
                         WHERE cm.channel_id = :id AND c.kind = 'dm'
                        """
                    ),
                    {"id": channel_id},
                )
            ).fetchall()
        }
    return None if members == {bot_user_id, person_id} else channel_id


async def caller_for(
    *, workspace_id: str, person_id: str, room_channel_id: str | None
) -> mcp_service.McpCaller | None:
    """The person an agent's calls run as, bounded to the room — or None if they are gone.

    Read scope only: the reads go through the catalogue's own executors, and the one
    write an agent has is run here, as the agent, after the person's approval.
    """
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT u.display_name, u.deactivated_at, w.name AS workspace_name
                      FROM users u JOIN workspaces w ON w.id = u.workspace_id
                     WHERE u.id = :id AND u.workspace_id = :ws AND u.kind = 'human'
                    """
                ),
                {"id": person_id, "ws": workspace_id},
            )
        ).fetchone()
    if row is None or row.deactivated_at is not None:
        return None
    return mcp_service.McpCaller(
        token_id="",
        token_name="agent run",  # noqa: S106 — a parameter name, not a secret
        user_id=person_id,
        workspace_id=workspace_id,
        display_name=row.display_name,
        workspace_name=row.workspace_name,
        scopes=frozenset({"read"}),
        room_channel_id=room_channel_id,
    )


def _capped(content: str) -> str:
    if len(content) <= RESULT_MAX_CHARS:
        return content
    dropped = len(content) - RESULT_MAX_CHARS
    return content[:RESULT_MAX_CHARS] + f"\n… ({dropped} more characters not shown)"


async def run_read(caller: mcp_service.McpCaller, call: ToolCall) -> ToolOutcome:
    """One read, as the person, inside the room. Never raises."""
    arguments = call.parsed_arguments()
    if arguments is None:
        return ToolOutcome("", "The arguments were not a JSON object.")
    try:
        return ToolOutcome(_capped(await mcp_service.call(caller, call.name, arguments)))
    except AppError as error:
        return ToolOutcome("", error.message)
    except Exception:
        log.warning("agui: tool %s failed inside Blob", call.name, exc_info=True)
        return ToolOutcome("", "That tool failed inside Blob; try something else.", failed=True)


async def prepare_write(
    caller: mcp_service.McpCaller, call: ToolCall, *, bot_user_id: str
) -> PreparedWrite | ToolOutcome:
    """Check a post before anyone is asked about it.

    A post that could never be made — no such channel inside the room, the person cannot
    write there, the agent's bot is not a member — is answered to the agent at once rather
    than put to the person: asking somebody to approve a post that will then fail is a
    question with no right answer.
    """
    arguments = call.parsed_arguments()
    if arguments is None:
        return ToolOutcome("", "The arguments were not a JSON object.")
    reference, body = arguments.get("channel"), arguments.get("text")
    if not isinstance(reference, str) or not reference.strip():
        return ToolOutcome("", "`channel` is required.")
    if not isinstance(body, str) or not body.strip():
        return ToolOutcome("", "`text` is required.")
    root = arguments.get("thread_root_id")
    if root is not None and (not isinstance(root, str) or not _UUID_RE.match(root.strip())):
        return ToolOutcome("", "`thread_root_id` has to be the id of a message.")
    try:
        async with session_scope() as session:
            channel_id = await mcp_service.resolve_channel(session, caller, reference)
            if isinstance(root, str):
                in_channel = (
                    await session.execute(
                        text(
                            """
                            SELECT 1 FROM messages
                             WHERE id = :id AND channel_id = :channel AND deleted_at IS NULL
                            """
                        ),
                        {"id": root.strip(), "channel": channel_id},
                    )
                ).first()
                if in_channel is None:
                    return ToolOutcome("", "There is no such thread in that channel.")
            await channel_service.assert_channel_access(
                session, caller.user_id, channel_id, require_member=True, require_writable=True
            )
            try:
                await channel_service.assert_channel_access(
                    session, bot_user_id, channel_id, require_member=True, require_writable=True
                )
            except AppError:
                return ToolOutcome("", "You are not a member of that channel; ask to be added.")
            channel = await channel_service.get_for_user(session, channel_id, caller.user_id)
    except AppError as error:
        return ToolOutcome("", error.message)
    label = f"#{channel.name}" if channel is not None and channel.name else "this conversation"
    return PreparedWrite(
        channel_id=channel_id,
        label=label,
        text=body.strip(),
        thread_root_id=root.strip() if isinstance(root, str) and root.strip() else None,
    )


#: What posting is handed: the channel, the thread, the text and the idempotency key, and
#: it answers the new message's id — or None if this call already posted it.
Post = Callable[[str, str | None, str, str], Awaitable[str | None]]


async def run_write(
    caller: mcp_service.McpCaller,
    prepared: PreparedWrite,
    *,
    bot_user_id: str,
    key: str,
    post: Post,
) -> ToolOutcome:
    """Post what the person approved, as the agent — checked again, since time passed.

    The person's access and the bot's membership are asked a second time: the approval can
    come a day later, and somebody may have left the channel since. `key` makes a repeat of
    this resume post nothing new.
    """
    try:
        async with session_scope() as session:
            await mcp_service.refuse_outside_the_room(session, caller, prepared.channel_id)
            await channel_service.assert_channel_access(
                session,
                caller.user_id,
                prepared.channel_id,
                require_member=True,
                require_writable=True,
            )
            await channel_service.assert_channel_access(
                session,
                bot_user_id,
                prepared.channel_id,
                require_member=True,
                require_writable=True,
            )
        message_id = await post(prepared.channel_id, prepared.thread_root_id, prepared.text, key)
    except AppError as error:
        return ToolOutcome("", f"Approved, but it could not be posted: {error.message}")
    except Exception:
        log.warning("agui: an approved post failed inside Blob", exc_info=True)
        return ToolOutcome("", "Approved, but Blob could not post it.", failed=True)
    if message_id is None:
        return ToolOutcome(f"Posted in {prepared.label}.")
    return ToolOutcome(f"Posted in {prepared.label}. Message id {message_id}.")


DECLINED = ToolOutcome("", "The person you are working for declined: it was not posted.")


def not_run(reason: str) -> ToolOutcome:
    return ToolOutcome("", f"Not run: {reason}")


def approval_item(agent_name: str, call: ToolCall, prepared: PreparedWrite) -> dict[str, Any]:
    """The question an approval puts to the person, in the interrupt shape decisions read.

    Its id is the call's, so the answer settles that call; the schema mints two buttons.
    """
    preview = prepared.text if len(prepared.text) <= 1500 else prepared.text[:1499] + "…"
    quoted = "\n".join(f"> {line}" if line else ">" for line in preview.splitlines())
    return {
        "id": call.id,
        "reason": "tool_approval",
        "message": f"{agent_name} wants to post in {prepared.label}:\n\n{quoted}",
        "responseSchema": {
            "oneOf": [
                {"const": True, "title": "Approve"},
                {"const": False, "title": "Deny"},
            ]
        },
    }


def assistant_turn(calls: Iterable[ToolCall], text_: str | None) -> dict[str, Any]:
    """The agent's own turn, as AG-UI's message history carries it: what it said, and the
    calls it made."""
    return {
        "id": new_id(),
        "role": "assistant",
        "content": text_ or None,
        "toolCalls": [
            {
                "id": call.id,
                "type": "function",
                "function": {"name": call.name, "arguments": call.arguments or "{}"},
            }
            for call in calls
        ],
    }


def tool_message(call_id: str, outcome: ToolOutcome, *, speaks_1_0: bool) -> dict[str, Any]:
    """A result, as a `tool` message.

    An error is said in the text for every agent; `error` is AG-UI 1.0's field for it,
    sent only to an agent that speaks 1.0 — an older parser refuses a member it does not
    know.
    """
    message: dict[str, Any] = {
        "id": new_id(),
        "role": "tool",
        "toolCallId": call_id,
        "content": outcome.content if outcome.error is None else f"Error: {outcome.error}",
    }
    if outcome.error is not None and speaks_1_0:
        message["error"] = outcome.error
    return message


def trim_exchange(exchange: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The exchange, small enough to keep on a run while an approval waits.

    Tool results are what grow; the oldest are stood down first, to a line that says
    so, and every call keeps a result — a model refuses a history with a call unanswered.
    """
    kept = [dict(message) for message in exchange]

    def size(message: dict[str, Any]) -> int:
        if message.get("role") == "tool":
            return len(str(message.get("content") or ""))
        calls = message.get("toolCalls") or []
        return sum(len(str(c.get("function", {}).get("arguments") or "")) for c in calls)

    total = sum(size(m) for m in kept)
    for message in kept:
        if total <= EXCHANGE_MAX_CHARS:
            break
        before = size(message)
        if message.get("role") == "tool":
            message["content"] = "(This result is no longer kept; call the tool again if needed.)"
        elif message.get("toolCalls"):
            message["toolCalls"] = [
                {**call, "function": {**call["function"], "arguments": "{}"}}
                for call in message["toolCalls"]
            ]
        total -= before - size(message)
    return kept


__all__ = [
    "ACCESS_LEVELS",
    "DECLINED",
    "MAX_CALLS_PER_ROUND",
    "MAX_TOOL_ROUNDS",
    "READ_TOOLS",
    "WRITE_TOOLS",
    "PreparedWrite",
    "ToolOutcome",
    "approval_item",
    "assistant_turn",
    "caller_for",
    "not_run",
    "offered",
    "offered_for",
    "offered_names",
    "prepare_write",
    "room_for",
    "run_read",
    "run_write",
    "tool_message",
    "trim_exchange",
]
