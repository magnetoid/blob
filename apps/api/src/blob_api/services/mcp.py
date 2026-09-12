"""What an assistant connected over MCP can see and do — and as whom.

Blob is the *server* here. The assistant is somebody's own — Claude Code in a terminal,
Claude in a browser tab, an editor's agent — and it connects with a token that person
minted for it. Everything below therefore runs as that person, through the same service
functions their browser calls, so there is exactly one answer to "what can it see?": the
same channels they can see, and no others. A private channel they are not in is a 404
here for the same reason it is a 404 there.

Two shapes are deliberately absent.

**No bot user.** The obvious design gives each assistant a `users` row, the way a plugin's
bot has one. That would mean inviting it into channels, seeing it in the member list, and
maintaining a second, drifting answer to the permission question. A token that resolves to
its owner has none of those problems and one nice property: revoke the person and every
assistant they connected stops with them.

**No output schemas.** Every tool answers with plain text, because a language model reads
prose and ids better than it reads a nested object, and because a declared `outputSchema`
obliges the server to conform to it for ever. The text always carries the ids, so a
follow-up call has something to name.

The catalogue is filtered by the token's scopes before it is listed, not only before it is
called: a read-only token does not see `post_message` at all, so the model never proposes
a call it cannot make.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import SessionFactory, session_scope, transaction
from ..lib.auth import hash_token
from ..lib.errors import bad_request, forbidden, not_found
from ..lib.ids import new_id
from ..lib.rate_limit import consume
from ..schemas.models import Message
from . import channels as channel_service
from . import messages as message_service
from . import search as search_service

#: What a token may hold. `read` is implied by every token; `write` is the second thought.
SCOPES = ("read", "write")

#: A page of anything. Big enough for a channel's morning, small enough that a model's
#: context is not spent on one call.
DEFAULT_LIMIT = 40
MAX_LIMIT = 100

#: A body longer than this is truncated in a listing. A model asking to read a channel
#: wants the shape of the conversation; `read_thread` is where the whole of one goes.
BODY_PREVIEW = 4000

_CHANNEL_NAME_RE = re.compile(r"^#?([a-z0-9][a-z0-9._-]{0,79})$")
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$")


@dataclass(slots=True)
class McpCaller:
    """The person an assistant is acting as."""

    token_id: str
    token_name: str
    user_id: str
    workspace_id: str
    display_name: str
    workspace_name: str
    scopes: frozenset[str]
    #: Whether a message this caller posts may root an agent chain.
    #:
    #: True for a person's assistant, because somebody typing `@Planner do this` into
    #: their own assistant is still somebody typing. False when an *agent* holds the
    #: tool: a model repeating a name it read in a channel did not mean to start
    #: anything, and ADR 0013 bounds chains by making a person's message the only thing
    #: that roots one. Without this, `post_message` would be a way around that guard
    #: rather than a use of it — an agent could mint person-shaped messages that start
    #: runs that post more messages.
    may_start_runs: bool = True

    def may_write(self) -> bool:
        return "write" in self.scopes


async def resolve_token(token: str) -> McpCaller | None:
    """The caller a bearer token names, or None. Never raises for a bad token."""
    if not token:
        return None
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT t.id AS token_id, t.name AS token_name, t.scopes,
                           u.id AS user_id, u.workspace_id, u.display_name,
                           u.deactivated_at, w.name AS workspace_name
                      FROM mcp_tokens t
                      JOIN users u ON u.id = t.user_id
                      JOIN workspaces w ON w.id = t.workspace_id
                     WHERE t.token_hash = :hash AND t.revoked_at IS NULL
                    """
                ),
                {"hash": hash_token(token)},
            )
        ).fetchone()
        if row is None or row.deactivated_at is not None:
            return None
        # Worth the write: it is how somebody tells a connection they still use from one
        # they set up once and forgot, which is the only reason to keep a revoke button.
        await session.execute(
            text("UPDATE mcp_tokens SET last_used_at = now() WHERE id = :id"),
            {"id": row.token_id},
        )
        await session.commit()

    return McpCaller(
        token_id=str(row.token_id),
        token_name=row.token_name,
        user_id=str(row.user_id),
        workspace_id=str(row.workspace_id),
        display_name=row.display_name,
        workspace_name=row.workspace_name,
        scopes=frozenset(row.scopes),
    )


# --------------------------------------------------------------------------------------
# The catalogue
# --------------------------------------------------------------------------------------

_LIMIT_SCHEMA = {
    "type": "integer",
    "minimum": 1,
    "maximum": MAX_LIMIT,
    "description": f"How many to return. Default {DEFAULT_LIMIT}, most {MAX_LIMIT}.",
}

_CHANNEL_SCHEMA = {
    "type": "string",
    "description": "A channel id, or a name like #general.",
}

#: The tools, once. `scope` is what an MCP *token* must hold; `grant` is the
#: `plugin_grants` scope an *agent* must have been given for the same tool, because an
#: agent's permissions are the plugin system's and a token's are its own. `None` means a
#: tool that asks the server nothing about the workspace and so needs no grant.
_CATALOGUE: list[dict[str, Any]] = [
    {
        "name": "whoami",
        "grant": None,
        "title": "Who this connection is",
        "description": (
            "Who this connection acts as, which workspace it is in, and whether it may "
            "post. Call this first if anything is ambiguous about identity."
        ),
        "inputSchema": {"type": "object", "properties": {}},
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_channels",
        "grant": "channels:read",
        "title": "List channels",
        "description": (
            "Channels this person is in, plus the public ones they could join. Private "
            "channels they are not in are not listed and cannot be read."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Only channels whose name contains this.",
                },
                "limit": _LIMIT_SCHEMA,
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "read_channel",
        "grant": "messages:read",
        "title": "Read a channel",
        "description": (
            "The most recent messages in a channel, oldest first. Pass `before` with the "
            "id of the oldest message you were given to page further back."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": _CHANNEL_SCHEMA,
                "limit": _LIMIT_SCHEMA,
                "before": {
                    "type": "string",
                    "description": "A message id; returns the messages before it.",
                },
            },
            "required": ["channel"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "read_thread",
        "grant": "messages:read",
        "title": "Read a thread",
        "description": "A thread in full: the message it started from and every reply.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "message_id": {
                    "type": "string",
                    "description": "The id of any message in the thread.",
                }
            },
            "required": ["message_id"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "search_messages",
        "grant": "messages:read",
        "title": "Search messages",
        "description": (
            "Full-text search across everything this person can see. Supports the same "
            "filters the app does: from:@name, in:#channel, before:2026-01-31, "
            "after:2026-01-01, has:link."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "What to search for."},
                "limit": _LIMIT_SCHEMA,
            },
            "required": ["query"],
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "list_people",
        "grant": "users:read",
        "title": "List people",
        "description": (
            "The people and agents in this workspace. A message names one by writing @ "
            "and their display name, which is what this returns."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Match part of a name."},
                "limit": _LIMIT_SCHEMA,
            },
        },
        "scope": "read",
        "readOnly": True,
    },
    {
        "name": "post_message",
        "grant": "messages:write.anywhere",
        "title": "Post a message",
        "description": (
            "Post to a channel or a thread, as the person this connection belongs to. "
            "Everyone in the channel sees it under their name, so say what it is."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": _CHANNEL_SCHEMA,
                "text": {"type": "string", "description": "What to say. Markdown works."},
                "thread_root_id": {
                    "type": "string",
                    "description": "Reply in this thread instead of the channel.",
                },
            },
            "required": ["channel", "text"],
        },
        "scope": "write",
        "readOnly": False,
    },
]


def catalogue(caller: McpCaller) -> list[dict[str, Any]]:
    """The tools this token may call, in the shape `tools/list` returns.

    Filtered rather than merely refused: a read-only token that saw `post_message` would
    have the model propose it, the call would fail, and the person would read a permission
    error they cannot act on from inside their assistant.
    """
    return [
        {
            "name": tool["name"],
            "title": tool["title"],
            "description": tool["description"],
            "inputSchema": tool["inputSchema"],
            "annotations": {
                "title": tool["title"],
                "readOnlyHint": tool["readOnly"],
                # Nothing here destroys anything: the worst a write does is add a message.
                "destructiveHint": False,
                "openWorldHint": False,
            },
        }
        for tool in _CATALOGUE
        if tool["scope"] in caller.scopes
    ]


# --------------------------------------------------------------------------------------
# Rendering — plain text, always carrying ids
# --------------------------------------------------------------------------------------


def tools_for_agent(scopes: frozenset[str]) -> list[dict[str, Any]]:
    """The same tools, offered to an agent, in the shape the model layer takes.

    One catalogue for both callers. An assistant reaching in over MCP and the workspace's
    own agent are the same kind of principal — something acting for a person, holding
    exactly that person's reach — so giving them separate tool tables would mean two
    definitions of what "read a channel" is, and the second one drifting.

    Filtered, not refused (the reason `catalogue` gives): a model offered a tool it may
    not use will call it, and the person reads a permission error in the middle of an
    answer.

    The read tools ride in on grants an agent already needs for other reasons.
    `post_message` does not: it hangs off `messages:write.anywhere`, which nothing is
    seeded with, because answering where it was asked and choosing where to speak are
    different powers and only the second one is what an injected instruction reaches for.
    """
    return [
        {
            "name": tool["name"],
            "description": tool["description"],
            "input_schema": tool["inputSchema"],
        }
        for tool in _CATALOGUE
        if tool["grant"] is None or tool["grant"] in scopes
    ]


def _when(value: str | None) -> str:
    """An ISO timestamp as something a model reads without arithmetic."""
    if not value:
        return "?"
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return moment.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")


async def _names(session: AsyncSession, user_ids: set[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    rows = (
        await session.execute(
            text("SELECT id, display_name FROM users WHERE id = ANY(:ids)"),
            {"ids": list(user_ids)},
        )
    ).fetchall()
    return {str(row.id): row.display_name for row in rows}


def _body(message: Message) -> str:
    if message.deleted_at:
        return "(deleted)"
    body = message.body.strip()
    if len(body) > BODY_PREVIEW:
        body = body[:BODY_PREVIEW] + f"… (+{len(message.body) - BODY_PREVIEW} more characters)"
    extras = []
    if message.attachments:
        extras.append(", ".join(item.filename for item in message.attachments))
    if message.reply_count:
        extras.append(f"{message.reply_count} repl{'y' if message.reply_count == 1 else 'ies'}")
    if message.edited_at:
        extras.append("edited")
    tail = f"  [{'; '.join(extras)}]" if extras else ""
    return (body or "(no text)") + tail


def _transcript(messages: list[Message], names: dict[str, str]) -> str:
    lines = []
    for message in messages:
        who = names.get(message.author_id or "", "someone")
        lines.append(f"[{message.id}] {_when(message.created_at)} {who}: {_body(message)}")
    return "\n".join(lines)


def _limit(arguments: dict[str, Any]) -> int:
    raw = arguments.get("limit")
    if raw is None:
        return DEFAULT_LIMIT
    if not isinstance(raw, int) or isinstance(raw, bool):
        raise bad_request("`limit` has to be a whole number.")
    return max(1, min(int(raw), MAX_LIMIT))


def _required(arguments: dict[str, Any], key: str) -> str:
    value = arguments.get(key)
    if not isinstance(value, str) or not value.strip():
        raise bad_request(f"`{key}` is required.")
    return value.strip()


def _an_id(value: str, what: str) -> str:
    """An id, checked here rather than by Postgres.

    A model hands back ids it read out of a transcript, and it will sometimes hand back
    something else. Unchecked, that reaches `cast(:id AS uuid)` and comes out as a 500 the
    assistant reads as "the server is broken" rather than "I made that up".
    """
    value = value.strip()
    if not _UUID_RE.match(value):
        raise bad_request(f"“{value}” is not a {what} id.")
    return value


async def _resolve_channel(session: AsyncSession, caller: McpCaller, reference: str) -> str:
    """A channel id, or a #name. Names are what a person types at their assistant."""
    reference = reference.strip()
    if _UUID_RE.match(reference):
        return reference
    match = _CHANNEL_NAME_RE.match(reference.lower())
    if not match:
        raise bad_request("That is not a channel id or name.")
    return await channel_service.id_by_name(
        session, caller.workspace_id, match.group(1), user_id=caller.user_id
    )


def _channel_label(name: str | None, kind: str) -> str:
    if name:
        return f"#{name}"
    return "a direct message" if kind == "dm" else "a group message"


# --------------------------------------------------------------------------------------
# The tools
# --------------------------------------------------------------------------------------


async def _whoami(caller: McpCaller, _arguments: dict[str, Any]) -> str:
    may = "read and post" if caller.may_write() else "read only — it cannot post"
    return (
        f"You are connected to the Blob workspace “{caller.workspace_name}” as "
        f"{caller.display_name}, user id {caller.user_id}.\n"
        f"This connection is “{caller.token_name}” and may {may}.\n"
        "Everything you can see is what this person can see; nothing else is reachable."
    )


async def _list_channels(caller: McpCaller, arguments: dict[str, Any]) -> str:
    query = str(arguments.get("query") or "").strip().lstrip("#").lower()
    limit = _limit(arguments)
    async with session_scope() as session:
        channels = await channel_service.list_for_user(session, caller.user_id, caller.workspace_id)
        member_names = await _dm_names(session, caller, channels)

    rows = []
    for channel in channels:
        label = channel.name or member_names.get(channel.id, "")
        if query and query not in label.lower():
            continue
        kind = channel.kind
        marks = []
        if channel.membership is None:
            marks.append("not joined")
        if channel.archived_at:
            marks.append("archived")
        if channel.has_unread:
            marks.append("unread")
        if channel.mention_count:
            marks.append(f"{channel.mention_count} mentions")
        suffix = f"  [{', '.join(marks)}]" if marks else ""
        topic = f" — {channel.topic}" if channel.topic else ""
        shown = f"#{label}" if channel.name else label or _channel_label(None, kind)
        rows.append(f"[{channel.id}] {shown} ({kind}){topic}{suffix}")
        if len(rows) >= limit:
            break

    if not rows:
        return "No channels match." if query else "This person is in no channels."
    return "\n".join(rows)


async def _dm_names(
    session: AsyncSession, caller: McpCaller, channels: list[Any]
) -> dict[str, str]:
    """Who a DM is with — a DM has no name, and "a direct message" names nothing."""
    dm_ids = [c.id for c in channels if c.kind in ("dm", "group_dm")]
    if not dm_ids:
        return {}
    rows = (
        await session.execute(
            text(
                """
                SELECT cm.channel_id, u.display_name
                  FROM channel_members cm
                  JOIN users u ON u.id = cm.user_id
                 WHERE cm.channel_id = ANY(:ids) AND cm.user_id <> :me
                 ORDER BY u.display_name
                """
            ),
            {"ids": dm_ids, "me": caller.user_id},
        )
    ).fetchall()
    names: dict[str, list[str]] = {}
    for row in rows:
        names.setdefault(str(row.channel_id), []).append(row.display_name)
    return {channel_id: ", ".join(people) for channel_id, people in names.items()}


async def _read_channel(caller: McpCaller, arguments: dict[str, Any]) -> str:
    reference = _required(arguments, "channel")
    limit = _limit(arguments)
    before = arguments.get("before")
    async with session_scope() as session:
        channel_id = await _resolve_channel(session, caller, reference)
        await channel_service.assert_channel_access(session, caller.user_id, channel_id)
        channel = await channel_service.get_for_user(session, channel_id, caller.user_id)
        messages, has_more = await message_service.history(
            session,
            channel_id,
            before=_an_id(str(before), "message") if before else None,
            limit=limit,
        )
        names = await _names(session, {m.author_id for m in messages if m.author_id})

    if not messages:
        return "That channel has no messages yet."
    label = (
        _channel_label(channel.name, channel.kind) if channel else _channel_label(None, "channel")
    )
    # `history` already answers oldest-first, whichever direction it paged in — sorting
    # the page by id is the last thing it does. Reversing here read a channel backwards.
    header = f"{label} — {len(messages)} message(s), oldest first."
    footer = (
        f"\n\nThere is more before this. Call read_channel again with before={messages[0].id}."
        if has_more
        else ""
    )
    return f"{header}\n\n{_transcript(messages, names)}{footer}"


async def _read_thread(caller: McpCaller, arguments: dict[str, Any]) -> str:
    message_id = _an_id(_required(arguments, "message_id"), "message")
    async with session_scope() as session:
        message = await message_service.by_id(session, message_id)
        if message is None:
            raise not_found("There is no message with that id.")
        await channel_service.assert_channel_access(session, caller.user_id, message.channel_id)
        root_id = message.thread_root_id or message.id
        # `thread` answers with the root *and* its replies, oldest first — the root is
        # not fetched separately, which is how it used to appear twice.
        everyone = await message_service.thread(session, root_id)
        names = await _names(session, {m.author_id for m in everyone if m.author_id})

    if not everyone:
        return "There is no thread there."
    count = max(len(everyone) - 1, 0)
    header = f"A thread with {count} repl{'y' if count == 1 else 'ies'}, oldest first."
    return f"{header}\n\n{_transcript(everyone, names)}"


async def _search_messages(caller: McpCaller, arguments: dict[str, Any]) -> str:
    query = _required(arguments, "query")
    limit = _limit(arguments)
    parsed = search_service.parse_query(query)
    if not parsed.text:
        raise bad_request("Give something to search for, not only filters.")
    async with session_scope() as session:
        messages, total, _cursor = await search_service.search(
            session,
            workspace_id=caller.workspace_id,
            user_id=caller.user_id,
            query=parsed.text,
            author_id=await _author_id(session, caller, parsed.author),
            channel_id=(
                await _resolve_channel(session, caller, parsed.channel) if parsed.channel else None
            ),
            before=parsed.before,
            after=parsed.after,
            has=parsed.has,
            limit=limit,
        )
        names = await _names(session, {m.author_id for m in messages if m.author_id})
        channels = await _channel_names(session, {m.channel_id for m in messages})

    if not messages:
        return f"Nothing matches “{query}”."
    lines = [
        f"[{m.id}] {_when(m.created_at)} in {channels.get(m.channel_id, 'a channel')} "
        f"{names.get(m.author_id or '', 'someone')}: {_body(m)}"
        for m in messages
    ]
    more = f"\n\n{total} match in all; showing {len(messages)}." if total > len(messages) else ""
    return "\n".join(lines) + more


async def _author_id(session: AsyncSession, caller: McpCaller, name: str | None) -> str | None:
    """`from:` resolved the way the app resolves it, or a refusal.

    The same exact-or-unique-prefix rule as `routers/search.py`, deliberately: two answers
    to "who is `from:ana`?" would make the same query mean different things depending on
    where it was typed. The app narrows an unresolved name to nothing and says so; here it
    is an error, because an assistant that reads "no results" cannot tell a quiet workspace
    from a misspelled name.
    """
    if not name:
        return None
    wanted = name.lstrip("@")
    candidates = (
        await session.execute(
            text(
                """
                SELECT id FROM users
                 WHERE workspace_id = :ws AND deactivated_at IS NULL
                   AND (lower(display_name) = lower(:name)
                        OR lower(display_name) LIKE lower(:name) || ' %')
                 ORDER BY (lower(display_name) = lower(:name)) DESC
                 LIMIT 2
                """
            ),
            {"ws": caller.workspace_id, "name": wanted},
        )
    ).fetchall()
    if len(candidates) != 1:
        raise not_found(
            f"“{wanted}” names nobody here."
            if not candidates
            else f"“{wanted}” names more than one person here; use their full name."
        )
    return str(candidates[0].id)


async def _channel_names(session: AsyncSession, channel_ids: set[str]) -> dict[str, str]:
    if not channel_ids:
        return {}
    rows = (
        await session.execute(
            text("SELECT id, name, kind FROM channels WHERE id = ANY(:ids)"),
            {"ids": list(channel_ids)},
        )
    ).fetchall()
    return {str(row.id): _channel_label(row.name, row.kind) for row in rows}


async def _list_people(caller: McpCaller, arguments: dict[str, Any]) -> str:
    query = str(arguments.get("query") or "").strip().lstrip("@").lower()
    limit = _limit(arguments)
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT u.id, u.display_name, u.title, u.kind
                      FROM users u
                     WHERE u.workspace_id = :ws AND u.deactivated_at IS NULL
                       AND (:q = '' OR lower(u.display_name) LIKE :like)
                     ORDER BY u.kind, lower(u.display_name)
                     LIMIT :limit
                    """
                ),
                {
                    "ws": caller.workspace_id,
                    "q": query,
                    "like": f"%{query}%",
                    "limit": limit,
                },
            )
        ).fetchall()

    if not rows:
        return "Nobody matches." if query else "This workspace has no members."
    lines = []
    for row in rows:
        kind = " (agent)" if row.kind == "bot" else ""
        title = f" — {row.title}" if row.title else ""
        lines.append(f"[{row.id}] @{row.display_name}{kind}{title}")
    return "\n".join(lines)


async def _post_message(caller: McpCaller, arguments: dict[str, Any]) -> str:
    if not caller.may_write():
        raise forbidden("This connection may only read.")
    reference = _required(arguments, "channel")
    body = _required(arguments, "text")
    thread_root_id = arguments.get("thread_root_id")

    # The same bucket a browser tab spends. An assistant in a loop is exactly the thing
    # this limit exists for, and it is per user, so it cannot be escaped by minting a
    # second token.
    await consume("send_message", caller.user_id)

    async with transaction() as (session, after):
        channel_id = await _resolve_channel(session, caller, reference)
        await channel_service.assert_channel_access(
            session, caller.user_id, channel_id, require_member=True, require_writable=True
        )
        result = await message_service.send(
            session,
            workspace_id=caller.workspace_id,
            channel_id=channel_id,
            author_id=caller.user_id,
            body=body,
            # A fresh id per call, deliberately. Every other write here is idempotent on
            # an id the client supplies, but an MCP client has none to supply and a hash
            # of the text would swallow the second of two identical messages — somebody
            # posting "+1" twice means it twice. A retried call therefore posts twice,
            # exactly as a person pressing send twice does.
            client_msg_id=new_id(),
            thread_root_id=(_an_id(str(thread_root_id), "message") if thread_root_id else None),
        )
        # Persist, then broadcast — `after` drains past COMMIT. Without this the message
        # is stored and nobody is told: no socket frame, no notification, no agent run.
        await message_service.announce(
            session,
            after,
            result,
            workspace_id=caller.workspace_id,
            channel_id=channel_id,
            start_agent_runs=caller.may_start_runs,
        )
    return f"Posted as {caller.display_name}. Message id {result.message.id}."


_HANDLERS = {
    "whoami": _whoami,
    "list_channels": _list_channels,
    "read_channel": _read_channel,
    "read_thread": _read_thread,
    "search_messages": _search_messages,
    "list_people": _list_people,
    "post_message": _post_message,
}


def known(name: str) -> bool:
    return name in _HANDLERS


async def call(caller: McpCaller, name: str, arguments: dict[str, Any]) -> str:
    """Run one tool. Raises `AppError` for anything the caller did wrong."""
    tool = next((item for item in _CATALOGUE if item["name"] == name), None)
    if tool is None:
        raise not_found(f"There is no tool called {name}.")
    # Before the scope check rather than after: a refused call is still a request that
    # reached this server, and a loop calling a tool it may not use is still a loop.
    await consume("mcp_tool", caller.user_id)
    if tool["scope"] not in caller.scopes:
        raise forbidden(
            f"This connection may only read, so it cannot use {name}. Its owner can mint "
            "one that posts from Settings → Assistants."
        )
    return await _HANDLERS[name](caller, arguments)


__all__ = [
    "DEFAULT_LIMIT",
    "MAX_LIMIT",
    "SCOPES",
    "McpCaller",
    "call",
    "catalogue",
    "known",
    "resolve_token",
    "tools_for_agent",
]
