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
from ..plugins import decisions
from ..plugins import events as plugin_events
from ..realtime import hub
from ..schemas.models import Message
from . import activity as activity_service
from . import agent_chains, agent_run_control, mcp_catalogue, task_dispatch
from . import agent_runs as agent_run_service
from . import audit as audit_service
from . import channels as channel_service
from . import messages as message_service
from . import reactions as reaction_service
from . import search as search_service
from . import thread_subscriptions as thread_service
from .mcp_catalogue import DEFAULT_LIMIT, MAX_LIMIT
from .serialize import channel_event, membership_event

#: What a token may hold. `read` is implied by every token; `write` is the second thought.
SCOPES = ("read", "write")

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
    #: The room this caller is answering in, when its reach is bounded to what that room
    #: could read for itself (ADR 0022, restoring 0017's rule).
    #:
    #: None for a person's own assistant — ADR 0016 says that credential *is* the person,
    #: it answers only them, and there is no room for it to leak into — and None for an
    #: agent answering in its own DM with the person, where the room is the person. Set
    #: to the channel id when an agent answers anywhere else: without it, "summarise
    #: #salaries" typed in #general by somebody who is in #salaries would read the private
    #: channel and land its contents in a public one.
    room_channel_id: str | None = None
    #: The person's role in the workspace — what decides, for example, whether they may
    #: hand an app's bot work (`task_dispatch.agent_for`).
    role: str = "member"

    def may_write(self) -> bool:
        return "write" in self.scopes

    @property
    def reads_are_room_bound(self) -> bool:
        return self.room_channel_id is not None


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
                           u.id AS user_id, u.workspace_id, u.display_name, u.role,
                           u.deactivated_at, w.name AS workspace_name
                      FROM mcp_tokens t
                      JOIN users u ON u.id = t.user_id
                      JOIN workspaces w ON w.id = t.workspace_id
                     WHERE t.token_hash = :hash AND t.revoked_at IS NULL
                       -- Past its date it is nobody (migration 0051). NULL only on a row
                       -- written outside the mint path, which never expires it.
                       AND (t.expires_at IS NULL OR t.expires_at > now())
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
        role=row.role,
    )


def catalogue(caller: McpCaller) -> list[dict[str, Any]]:
    """The tools this token may call, in the shape `tools/list` returns."""
    return mcp_catalogue.for_token(caller.scopes)


# --------------------------------------------------------------------------------------
# Rendering — plain text, always carrying ids
# --------------------------------------------------------------------------------------


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
        # An id is not a shortcut past the bound: guessing one, or reading it out of a
        # message, must not reach further than typing the name would.
        await refuse_outside_the_room(session, caller, reference)
        return reference
    match = _CHANNEL_NAME_RE.match(reference.lower())
    if not match:
        raise bad_request("That is not a channel id or name.")
    channel_id = await channel_service.id_by_name(
        session, caller.workspace_id, match.group(1), user_id=caller.user_id
    )
    await refuse_outside_the_room(session, caller, channel_id)
    return channel_id


async def resolve_channel(session: AsyncSession, caller: McpCaller, reference: str) -> str:
    """A channel id or #name, as the caller, inside the caller's room. Raises `AppError`."""
    return await _resolve_channel(session, caller, reference)


async def refuse_outside_the_room(
    session: AsyncSession, caller: McpCaller, channel_id: str
) -> None:
    """Stop a room-bound caller reaching somewhere the room could not read.

    The person's own membership is still the floor — every read goes through
    `assert_channel_access` as them — and this is the ceiling on top of it: a public
    channel, or the room the answer is going into, and nothing else.

    Refused as "no such channel", never as a permission error. A private channel's
    existence is private (the rule the app keeps by answering 404), and an agent that
    said "you may not read that" would confirm the channel to everyone in the room.
    """
    if not caller.reads_are_room_bound:
        return
    if channel_id == caller.room_channel_id:
        return
    row = (
        await session.execute(
            text("SELECT kind FROM channels WHERE id = :id AND workspace_id = :ws"),
            {"id": channel_id, "ws": caller.workspace_id},
        )
    ).fetchone()
    if row is None or row.kind != "public":
        raise not_found("There is no channel by that name.")


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
        if caller.reads_are_room_bound:
            channels = [c for c in channels if c.kind == "public" or c.id == caller.room_channel_id]
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
        await refuse_outside_the_room(session, caller, message.channel_id)
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
    raw_cursor = arguments.get("cursor")
    cursor = search_service.SearchCursor.decode(str(raw_cursor)) if raw_cursor else None
    async with session_scope() as session:
        messages, total, next_cursor = await search_service.search(
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
            cursor=cursor,
            audience_channel_id=caller.room_channel_id,
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
    # The page after this one: the search's own cursor, handed back as it came, so the
    # next page is the same search and not a new one that happens to share words.
    following = (
        f"\nFor the next page, call search_messages again with cursor={next_cursor.encode()}."
        if next_cursor is not None
        else ""
    )
    return "\n".join(lines) + more + following


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
            # The assistant's own id when it gives one — a retry after a dropped response
            # then posts nothing new — and a fresh one when it does not: a hash of the
            # text would swallow the second of two identical messages, and somebody
            # posting "+1" twice means it twice.
            client_msg_id=_client_id(caller, arguments),
            thread_root_id=(_an_id(str(thread_root_id), "message") if thread_root_id else None),
        )
        # Persist, then broadcast — `after` drains past COMMIT. Without this the message
        # is stored and nobody is told: no socket frame, no notification, no agent run.
        #
        # A mention in it roots a chain, which is `announce`'s default: somebody typing
        # `@Planner do this` into their own assistant is still somebody typing, and a
        # token here resolves to a person and never to an agent (ADR 0016).
        await message_service.announce(
            session,
            after,
            result,
            workspace_id=caller.workspace_id,
            channel_id=channel_id,
        )
    if not result.created:
        return f"Already posted, as message id {result.message.id}: nothing new was sent."
    return f"Posted as {caller.display_name}. Message id {result.message.id}."


def _client_id(caller: McpCaller, arguments: dict[str, Any]) -> str:
    """The id a post is idempotent on. The assistant's own, scoped to its token so two
    assistants choosing the same string do not collide; or a fresh one."""
    given = arguments.get("client_msg_id")
    if given is None:
        return new_id()
    value = str(given).strip()
    if not value or len(value) > 64:
        raise bad_request("A client_msg_id is 1 to 64 characters.")
    return f"mcp:{caller.token_id}:{value}"


async def _visible_channels(
    session: AsyncSession, caller: McpCaller, channel_ids: set[str]
) -> set[str]:
    """Which of these channels this person can see now: public ones, and ones they are in.
    A followed thread in a private channel they have since left is not theirs to list."""
    if not channel_ids:
        return set()
    rows = (
        await session.execute(
            text(
                """
                SELECT c.id FROM channels c
                 WHERE c.id = ANY(cast(:ids AS uuid[])) AND c.workspace_id = :ws
                   AND (c.kind = 'public' OR EXISTS (
                         SELECT 1 FROM channel_members cm
                          WHERE cm.channel_id = c.id AND cm.user_id = :me))
                """
            ),
            {"ids": list(channel_ids), "ws": caller.workspace_id, "me": caller.user_id},
        )
    ).fetchall()
    return {str(row.id) for row in rows}


def _person_only(caller: McpCaller, tool: str) -> None:
    """A tool about the person themselves — their unread, their threads. Never offered to
    an agent (ADR 0022 lists what is), and refused should one ask: an agent in a room
    reads that room, not its asker's inbox."""
    if caller.reads_are_room_bound:
        raise forbidden(f"{tool} reads the person's own inbox, which is not offered here.")


async def _inbox(caller: McpCaller, arguments: dict[str, Any]) -> str:
    _person_only(caller, "inbox")
    limit = _limit(arguments)
    async with session_scope() as session:
        channels = await channel_service.list_for_user(session, caller.user_id, caller.workspace_id)
        waiting = [
            c for c in channels if c.membership is not None and (c.has_unread or c.mention_count)
        ]
        # Mentions first: a channel that named them is the one they are waited on in.
        waiting.sort(key=lambda c: (-(c.mention_count or 0), (c.name or "").lower()))
        member_names = await _dm_names(session, caller, waiting)
        items, _cursor = await activity_service.feed(
            session,
            workspace_id=caller.workspace_id,
            user_id=caller.user_id,
            kind="mention",
            limit=min(limit, 10),
        )
        mentions = [item.message for item in items]
        names = await _names(session, {m.author_id for m in mentions if m.author_id})
        labels = await _channel_names(session, {m.channel_id for m in mentions})

    lines: list[str] = []
    if waiting:
        lines.append("Unread:")
        for channel in waiting[:limit]:
            label = (
                f"#{channel.name}"
                if channel.name
                else member_names.get(channel.id) or _channel_label(None, channel.kind)
            )
            what = (
                f"{channel.mention_count} mention{'' if channel.mention_count == 1 else 's'}"
                if channel.mention_count
                else "unread"
            )
            lines.append(f"[{channel.id}] {label} — {what}")
    if mentions:
        lines.append("")
        lines.append("Mentioned lately:")
        lines.extend(
            f"[{m.id}] {_when(m.created_at)} in {labels.get(m.channel_id, 'a conversation')} "
            f"{names.get(m.author_id or '', 'someone')}: {_body(m)}"
            for m in mentions
        )
    if not lines:
        return "Nothing waiting: every conversation is read, and nobody has mentioned them lately."
    return "\n".join(lines).strip()


async def _list_threads(caller: McpCaller, arguments: dict[str, Any]) -> str:
    _person_only(caller, "list_threads")
    limit = _limit(arguments)
    async with session_scope() as session:
        roots, unread = await thread_service.threads_for_user(session, caller.user_id, limit=limit)
        visible = await _visible_channels(session, caller, {r.channel_id for r in roots})
        roots = [r for r in roots if r.channel_id in visible]
        names = await _names(session, {r.author_id for r in roots if r.author_id})
        labels = await _channel_names(session, {r.channel_id for r in roots})

    if not roots:
        return "They follow no threads."
    new = set(unread)
    # `_body` already says how many replies each has.
    lines = [
        f"[{root.id}] in {labels.get(root.channel_id, 'a conversation')} "
        f"{names.get(root.author_id or '', 'someone')}: {_body(root)}"
        + (" — new replies" if root.id in new else "")
        for root in roots
    ]
    return "\n".join(lines)


async def _person_id(session: AsyncSession, caller: McpCaller, reference: str) -> str:
    """A person or agent named by id or by display name, in this workspace and active."""
    value = reference.strip()
    if _UUID_RE.match(value):
        row = (
            await session.execute(
                text(
                    "SELECT id FROM users WHERE id = :id AND workspace_id = :ws "
                    "AND deactivated_at IS NULL"
                ),
                {"id": value, "ws": caller.workspace_id},
            )
        ).fetchone()
        if row is None:
            raise not_found("There is nobody here with that id.")
        return str(row.id)
    found = await _author_id(session, caller, value)
    if found is None:
        raise not_found("Name somebody.")
    return found


async def _message_person(caller: McpCaller, arguments: dict[str, Any]) -> str:
    if not caller.may_write():
        raise forbidden("This connection may only read.")
    reference = _required(arguments, "to")
    body = _required(arguments, "text")
    await consume("send_message", caller.user_id)

    async with transaction() as (session, after):
        person_id = await _person_id(session, caller, reference)
        if person_id == caller.user_id:
            raise bad_request("That is the person this connection acts as.")
        members = [caller.user_id, person_id]
        channel_id, created = await channel_service.find_or_create_dm(
            session, caller.workspace_id, members
        )
        if created:
            # A new DM appears in both sidebars at once, as it does when opened in the app.
            views = {
                member_id: await channel_service.get_for_user(session, channel_id, member_id)
                for member_id in members
            }

            def opened() -> None:
                for member_id, view in views.items():
                    hub.subscribe_users([member_id], [channel_id])
                    if view is not None:
                        hub.to_users([member_id], channel_event("channel.created", view))
                        hub.to_users([member_id], membership_event(view))

            after.add(opened)
        result = await message_service.send(
            session,
            workspace_id=caller.workspace_id,
            channel_id=channel_id,
            author_id=caller.user_id,
            body=body,
            client_msg_id=_client_id(caller, arguments),
        )
        await message_service.announce(
            session, after, result, workspace_id=caller.workspace_id, channel_id=channel_id
        )
        names = await _names(session, {person_id})
    who = names.get(person_id, "them")
    if not result.created:
        return f"Already sent to {who}, as message id {result.message.id}."
    return (
        f"Sent to {who} as {caller.display_name}. Message id {result.message.id}, "
        f"in DM {channel_id}."
    )


async def _add_reaction(caller: McpCaller, arguments: dict[str, Any]) -> str:
    if not caller.may_write():
        raise forbidden("This connection may only read.")
    message_id = _an_id(_required(arguments, "message_id"), "message")
    emoji = _required(arguments, "emoji").strip()
    if len(emoji) > 64:
        raise bad_request("An emoji is at most 64 characters.")
    async with transaction() as (session, after):
        existing = await message_service.load_for(
            session, caller.user_id, message_id, require_member=True, require_writable=True
        )
        await refuse_outside_the_room(session, caller, existing.channel_id)
        if await reaction_service.add(session, message_id, caller.user_id, emoji):
            reaction = {
                "messageId": message_id,
                "channelId": existing.channel_id,
                "threadRootId": existing.thread_root_id,
                "emoji": emoji,
                "userId": caller.user_id,
            }
            await plugin_events.emit(
                session,
                workspace_id=caller.workspace_id,
                event="reaction.added",
                channel_id=existing.channel_id,
                payload=reaction,
            )
            after.add(
                lambda: hub.to_channel(existing.channel_id, {"t": "reaction.added", **reaction})
            )
    return f"Reacted {emoji} to message {message_id} as {caller.display_name}."


async def _ask_agent(caller: McpCaller, arguments: dict[str, Any]) -> str:
    if not caller.may_write():
        raise forbidden("This connection may only read.")
    agent_reference = _required(arguments, "agent")
    reference = _required(arguments, "channel")
    body = _required(arguments, "text")
    thread_root_id = arguments.get("thread_root_id")
    await consume("send_message", caller.user_id)

    async with transaction() as (session, after):
        channel_id = await _resolve_channel(session, caller, reference)
        bot_id = await _person_id(session, caller, agent_reference)
        # The rules a mention meets, asked up front and said aloud: an assistant cannot see
        # that nothing happened, as a person in the room can (ADR 0023's helper).
        agent = await task_dispatch.agent_for(
            session,
            workspace_id=caller.workspace_id,
            channel_id=channel_id,
            actor_id=caller.user_id,
            actor_role=caller.role,
            assignee_user_id=bot_id,
            handing_over=False,
        )
        if agent is None:
            raise bad_request(f"“{agent_reference}” is not an agent.", code="not_an_agent")
        result = await message_service.send(
            session,
            workspace_id=caller.workspace_id,
            channel_id=channel_id,
            author_id=caller.user_id,
            body=f"@{agent.name} {body}",
            client_msg_id=_client_id(caller, arguments),
            thread_root_id=(_an_id(str(thread_root_id), "message") if thread_root_id else None),
            # The agent asked, and nobody else: a name in the question is part of it.
            mention_user_ids=[agent.bot_user_id],
        )
        await message_service.announce(
            session, after, result, workspace_id=caller.workspace_id, channel_id=channel_id
        )
    message_id = result.message.id
    if not result.created:
        return f"Already asked, as message id {message_id}. Follow it with run_status."
    return (
        f"Asked {agent.name} as {caller.display_name}. Message id {message_id}. "
        f"Call run_status with message_id={message_id} to follow its run."
    )


def _status_lines(view: dict[str, Any], answer: list[str], caller: McpCaller) -> list[str]:
    status = str(view["status"])
    lines = [f"Run {view['id']} — {view['agentName']}: {status}"]
    if view.get("error"):
        lines.append(f"Why: {view['error']}")
    decision = view.get("decision")
    if decision:
        yours = view.get("initiatedByUserId") == caller.user_id
        lines.append(
            f"It asks{' this person' if yours else ' the person it runs for'}: {decision['prompt']}"
        )
        if decision["choices"]:
            lines.extend(
                f"  {index}. {choice['label']}" for index, choice in enumerate(decision["choices"])
            )
            how = "with answer_decision and the choice's number"
        else:
            how = "with answer_decision and words"
        if yours:
            lines.append(f"Answer {how}.")
        if view.get("expiresAt"):
            lines.append(f"The question closes at {view['expiresAt']}.")
    if answer:
        lines.append("It answered:")
        lines.extend(answer)
    elif status == "running":
        lines.append("Still going; ask again in a little while.")
    return lines


async def _run_status(caller: McpCaller, arguments: dict[str, Any]) -> str:
    run_id = arguments.get("run_id")
    message_id = arguments.get("message_id")
    if not run_id and not message_id:
        raise bad_request("Name the run, or the message that asked the agent.")
    async with session_scope() as session:
        if run_id:
            view = await agent_run_service.view_in(
                session, workspace_id=caller.workspace_id, run_id=_an_id(str(run_id), "run")
            )
            views = [view] if view is not None else []
        else:
            views = await agent_run_service.views_for_trigger(
                session,
                workspace_id=caller.workspace_id,
                message_id=_an_id(str(message_id), "message"),
            )
        for view in views:
            # The room's rule, before anything about the run is said.
            await channel_service.assert_channel_access(
                session, caller.user_id, str(view["channelId"])
            )
            await refuse_outside_the_room(session, caller, str(view["channelId"]))
        answers = {
            str(view["id"]): await agent_run_service.answer_of(session, str(view["id"]))
            for view in views
        }
    if not views:
        if run_id:
            raise not_found("There is no run with that id.")
        return (
            "No agent has run on that message yet. A run starts a moment after the message "
            "does — ask again shortly."
        )
    blocks = ["\n".join(_status_lines(view, answers[str(view["id"])], caller)) for view in views]
    return "\n\n".join(blocks)


async def _answer_decision(caller: McpCaller, arguments: dict[str, Any]) -> str:
    if not caller.may_write():
        raise forbidden("This connection may only read.")
    run_id = _an_id(_required(arguments, "run_id"), "run")
    choice = arguments.get("choice")
    words = str(arguments.get("text") or "").strip()
    if (choice is None) == (not words):
        raise bad_request("Answer with the number of a choice or with words — one of the two.")
    if choice is not None and (
        isinstance(choice, bool) or not isinstance(choice, int) or choice < 0
    ):
        raise bad_request("A choice is its number in the list run_status gives, counting from 0.")
    # The room's ceiling, as `run_status` and `stop_run` keep it. No caller that is bound
    # to a room may write today — an agent's tools read, and its one write is Blob's own
    # (`jobs/agui_tools.py`) — so this guards the day that changes rather than a path that
    # is open now (review of phase 6).
    async with session_scope() as session:
        view = await agent_run_service.view_in(
            session, workspace_id=caller.workspace_id, run_id=run_id
        )
        if view is not None:
            await refuse_outside_the_room(session, caller, str(view["channelId"]))
    await consume("send_message", caller.user_id)
    async with transaction() as (session, after):
        answered = await agent_chains.answer(
            session,
            after,
            workspace_id=caller.workspace_id,
            run_id=run_id,
            user_id=caller.user_id,
            user_name=caller.display_name,
            action_id=(
                f"{decisions.ACTION_PREFIX}{run_id}:{choice}" if choice is not None else None
            ),
            value=words,
            client_action_id=None,
        )
        await audit_service.record(
            session,
            audit_service.Actor(id=caller.user_id, workspace_id=caller.workspace_id),
            "agent.run_answered",
            target_type="agent_run",
            target_id=run_id,
            metadata={"channelId": answered.channel_id, "via": "mcp"},
        )
    return "Answered, as this person. The agent carries on; follow it with run_status."


async def _stop_run(caller: McpCaller, arguments: dict[str, Any]) -> str:
    if not caller.may_write():
        raise forbidden("This connection may only read.")
    run_id = _an_id(_required(arguments, "run_id"), "run")
    async with session_scope() as session:
        view = await agent_run_service.view_in(
            session, workspace_id=caller.workspace_id, run_id=run_id
        )
        if view is not None:
            await refuse_outside_the_room(session, caller, str(view["channelId"]))
    cascaded = await agent_run_control.stop(
        workspace_id=caller.workspace_id,
        run_id=run_id,
        user_id=caller.user_id,
        actor=audit_service.Actor(id=caller.user_id, workspace_id=caller.workspace_id),
    )
    also = f", and {cascaded} run{'' if cascaded == 1 else 's'} it set going" if cascaded else ""
    return f"Stopped run {run_id}{also}."


_HANDLERS = {
    "whoami": _whoami,
    "list_channels": _list_channels,
    "read_channel": _read_channel,
    "read_thread": _read_thread,
    "search_messages": _search_messages,
    "list_people": _list_people,
    "post_message": _post_message,
    "inbox": _inbox,
    "list_threads": _list_threads,
    "message_person": _message_person,
    "add_reaction": _add_reaction,
    "ask_agent": _ask_agent,
    "run_status": _run_status,
    "answer_decision": _answer_decision,
    "stop_run": _stop_run,
}


def known(name: str) -> bool:
    return name in _HANDLERS


async def call(caller: McpCaller, name: str, arguments: dict[str, Any]) -> str:
    """Run one tool. Raises `AppError` for anything the caller did wrong."""
    tool = next((item for item in mcp_catalogue.CATALOGUE if item["name"] == name), None)
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
    "refuse_outside_the_room",
    "resolve_channel",
    "resolve_token",
]
