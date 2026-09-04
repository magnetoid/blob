"""Slash commands.

Two decisions shape this file.

**Dispatch is the server's.** The composer could recognise `/topic` and call the channel
endpoint itself, and for the built-ins here that would even be less code. It would
also mean an app-provided command — the half of milestone 19 still to come — needing a
second, unrelated dispatch path, and the conflict between two apps claiming `/deploy`
having nowhere to be resolved. One endpoint, one namespace, one place to say no.

**Nothing here broadcasts.** A command that changes something returns *what changed*, and
the router emits after the transaction commits. That is the same persist-then-broadcast
discipline the rest of the codebase keeps structurally, and putting `hub` in a service
would be the first crack in it.

An unknown command is not an error the workspace should feel. `/deploy` typed into a
workspace with no such command answers with an ephemeral "no such command" rather than a
400, because the alternative is a red banner for a typo — and, once apps can register
commands, for one that exists in a colleague's workspace and not in yours.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser
from ..lib.mentions import simple_lower
from ..realtime import presence
from ..schemas.models import ChannelWithState, Message, User
from ..schemas.requests import ChannelNameMixin
from . import agent_access
from . import channels as channel_service
from . import messages as message_service
from . import reminders as reminder_service
from .serialize import USER_COLUMNS, to_user

#: What a command may ask the router to do once the transaction has committed.
Presence = Literal["active", "away"]

#: The same cap `CreateDmInput` puts on `POST /api/dms`. Named here because a command
#: reaching the service directly does not pass through that schema.
MAX_DM_MEMBERS = 8

#: What `channel_members.notify_level` starts as — see `db/models.py`. Un-muting returns
#: here rather than to "all", which nobody chose.
DEFAULT_NOTIFY_LEVEL = "mentions"

#: The same bounds `UpdateProfileInput` puts on a status set through the profile dialog.
MAX_STATUS_EMOJI = 64
MAX_STATUS_TEXT = 100


@dataclass(slots=True)
class CommandContext:
    session: AsyncSession
    user: SessionUser
    channel_id: str
    #: Everything after the command name, stripped. Empty string when there was nothing.
    args: str
    #: The client's id for any message this command posts, so a retry is not a duplicate.
    client_msg_id: str


@dataclass(slots=True)
class CommandResult:
    """What happened, for the router to broadcast.

    Every field is something the caller may need to emit; none of them is emitted here.
    """

    #: Shown to the person who ran the command, and to nobody else. Never persisted.
    ephemeral: str | None = None
    #: Set when the command posted a real message.
    message: Message | None = None
    thread_update: message_service.ThreadUpdate | None = None
    #: Set when the command changed the channel, for `channel.updated`.
    channel: ChannelWithState | None = None
    #: Set when the invoker is no longer a member, for `member.left` and unsubscribing.
    left_channel: bool = False
    #: Set when the command changed the invoker's presence.
    presence: Presence | None = None
    #: People this command added here, for `member.joined` and their subscriptions.
    added_user_ids: list[str] = field(default_factory=list)
    #: And people it removed, for `member.left` and unsubscribing them.
    removed_user_ids: list[str] = field(default_factory=list)
    #: Set when the command archived this channel.
    archived: bool = False
    #: A channel the invoker should be told about — `/join`, `/dm`, `/remind`. Their new
    #: view of it, so the sidebar has the row before anything asks it to render one.
    open_channel: ChannelWithState | None = None
    #: Who else should be told about `open_channel` and subscribed to it. Empty when the
    #: channel already existed, since their socket is already on it.
    open_channel_members: list[str] = field(default_factory=list)
    #: Whether to *go* there as well as be told. False for `/remind`: it is something you
    #: say in passing, and taking somebody out of the conversation they were reading to
    #: show them a note they will get tomorrow is the opposite of what they asked for.
    navigate: bool = True
    #: The invoker's own view of a channel changed — a mute is nobody else's business,
    #: unlike `channel`, which goes to everyone in it.
    own_channel: ChannelWithState | None = None
    #: A message posted somewhere other than the channel the command was run in, which
    #: `/dm` is the only case of. Kept apart from `message` because the router broadcasts
    #: that one into the channel it was invoked from.
    dm_message: Message | None = None
    dm_thread_update: message_service.ThreadUpdate | None = None
    dm_channel_id: str | None = None
    #: The invoker's own profile changed — `/status` — for `user.updated`.
    user: User | None = None


Handler = Callable[[CommandContext], Awaitable[CommandResult]]


@dataclass(frozen=True, slots=True)
class Command:
    name: str
    #: Shown in `/help`, in the order the fields read: `/topic <text>`.
    usage: str
    summary: str
    handler: Handler = field(compare=False)
    #: A command that writes to the channel needs the same access a message does.
    writes: bool = False


async def _help(ctx: CommandContext) -> CommandResult:
    lines = [f"`/{c.name} {c.usage}`".replace(" `", "`") + f" — {c.summary}" for c in ordered()]
    return CommandResult(ephemeral="\n".join(lines))


async def _shrug(ctx: CommandContext) -> CommandResult:
    body = f"{ctx.args} ¯\\_(ツ)_/¯".strip()
    result = await message_service.send(
        ctx.session,
        workspace_id=ctx.user.workspace_id,
        channel_id=ctx.channel_id,
        author_id=ctx.user.id,
        body=body,
        client_msg_id=ctx.client_msg_id,
    )
    return CommandResult(message=result.message, thread_update=result.thread_update)


async def _me(ctx: CommandContext) -> CommandResult:
    """Post an action.

    Slack renders `/me waves` as italic text attributed to you, and this posts exactly
    that: a normal message whose body is italicised. The alternative — a `system` message
    kind the client would have to learn to render — buys nothing a reader could see, and
    costs a message that cannot be edited back into ordinary text.
    """
    if not ctx.args:
        return CommandResult(ephemeral="`/me` needs something to do — try `/me waves`.")

    result = await message_service.send(
        ctx.session,
        workspace_id=ctx.user.workspace_id,
        channel_id=ctx.channel_id,
        author_id=ctx.user.id,
        body=f"_{ctx.args}_",
        client_msg_id=ctx.client_msg_id,
    )
    return CommandResult(message=result.message, thread_update=result.thread_update)


async def _topic(ctx: CommandContext) -> CommandResult:
    access = await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True, require_writable=True
    )
    if access.kind in ("dm", "group_dm"):
        return CommandResult(ephemeral="Direct messages have no topic.")

    await ctx.session.execute(
        text("UPDATE channels SET topic = :topic WHERE id = :channel_id"),
        {"topic": ctx.args, "channel_id": ctx.channel_id},
    )
    channel = await channel_service.get_for_user(ctx.session, ctx.channel_id, ctx.user.id)
    cleared = not ctx.args
    return CommandResult(
        ephemeral="Topic cleared." if cleared else f"Topic set to “{ctx.args}”.",
        channel=channel,
    )


def _matches_handle(text: str, handle: str) -> int:
    """How many characters of `text` this handle consumes, or 0.

    Both lowercasings are tried because the two sides of this comparison are lowercased
    by different things: the handle by Postgres, the typed text by Python, and for a name
    like "İlker" those disagree. `lib/mentions` makes the same allowance on the way in.
    """
    for lower in (str.lower, simple_lower):
        head = lower(text[: len(handle)])
        if head == handle:
            after = text[len(handle) :]
            # A boundary, or `@Ana` would eat the start of `@Anabel`.
            if after == "" or after[0].isspace():
                return len(handle)
    return 0


async def _resolve_people(ctx: CommandContext) -> tuple[list[str], str]:
    """The people the *leading* run of `@name`s names, and the words after them.

    Only the leading run, and that is the whole point. Resolving mentions across the
    whole argument made `/dm @Ana what did @Bob mean by that?` open a group with Bob in
    it — a message about somebody, delivered to them — and made
    `/remove @Third because @Owner asked me to` remove the person who was named as the
    reason. A name in the message is a name, not an instruction.

    Resolution goes through `mention_targets`, the same index the composer highlights
    against and the same one that decides who a message notifies. So a name that
    autocompletes is a name these accept, a group works wherever a person does, and
    `@Ana Smith` is one person rather than Ana and a stray word — the handles are tried
    longest-first, which is what makes a two-word name win over its first word.
    """
    targets = await message_service.mention_targets(ctx.session, ctx.user.workspace_id, ctx.args)
    longest_first = sorted(targets, key=len, reverse=True)

    user_ids: list[str] = []
    groups: list[str] = []
    rest = ctx.args.strip()
    while rest.startswith("@"):
        after_at = rest[1:]
        taken = 0
        for handle in longest_first:
            taken = _matches_handle(after_at, handle)
            if taken:
                kind, target_id = targets[handle]
                if kind == "group":
                    groups.append(target_id)
                else:
                    user_ids.append(target_id)
                rest = after_at[taken:].strip()
                break
        if not taken:
            # An `@` that names nobody ends the run rather than being skipped: the rest
            # is message text, and guessing past it is how the wrong person gets added.
            break

    if groups:
        rows = (
            await ctx.session.execute(
                text(
                    """
                    SELECT DISTINCT m.user_id
                      FROM user_group_members m
                      JOIN users u ON u.id = m.user_id
                     WHERE m.group_id = ANY(cast(:ids AS uuid[]))
                       AND u.deactivated_at IS NULL
                    """
                ),
                {"ids": groups},
            )
        ).fetchall()
        user_ids.extend(str(row.user_id) for row in rows)

    # Order-preserving dedupe: `/invite @Ana @designers` where Ana is a designer must
    # not try to add her twice.
    seen: dict[str, None] = {}
    for user_id in user_ids:
        seen[user_id] = None
    return list(seen), rest


def _nobody(ctx: CommandContext, verb: str) -> CommandResult:
    if ctx.args.strip():
        return CommandResult(ephemeral=f"No one here is called {ctx.args.strip()}.")
    return CommandResult(ephemeral=f"Say who — `/{verb} @name`.")


async def _invite(ctx: CommandContext) -> CommandResult:
    """Slack's `/invite @person`, which is how most people add somebody to a channel."""
    access = await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True, require_writable=True
    )
    if access.kind in ("dm", "group_dm"):
        return CommandResult(ephemeral="Start a new group message instead of adding people here.")

    user_ids, _rest = await _resolve_people(ctx)
    if not user_ids:
        return _nobody(ctx, "invite")

    already = set(await channel_service.member_ids(ctx.session, ctx.channel_id))
    joining = [user_id for user_id in user_ids if user_id not in already]
    if not joining:
        return CommandResult(ephemeral="They're already here.")

    await channel_service.add_members(ctx.session, ctx.channel_id, joining)
    return CommandResult(
        ephemeral=f"Added {len(joining)} {'person' if len(joining) == 1 else 'people'}.",
        added_user_ids=joining,
    )


async def _agent_owner_and_bot(ctx: CommandContext, user_ids: list[str]) -> tuple[str, str] | str:
    """Split `@agent @person…` into the agent's plugin and the rest, or say what is wrong.

    The first name has to be an agent and it has to be yours. Both refusals are worded for
    somebody who mistyped rather than somebody probing: the workspace's own agent needs no
    lending because it already answers everyone, and an agent you do not own is not yours
    to lend.
    """
    first = user_ids[0]
    row = (
        await ctx.session.execute(
            text(
                """
                SELECT p.id AS plugin_id, p.owner_user_id, u.display_name
                  FROM users u JOIN plugins p ON p.id = u.bot_plugin_id
                 WHERE u.id = :id AND u.workspace_id = :ws
                """
            ),
            {"id": first, "ws": ctx.user.workspace_id},
        )
    ).fetchone()
    if row is None:
        return "Name the agent first, then the people: `/allow @agent @name`."
    if row.owner_user_id is None:
        return f"{row.display_name} is the workspace's agent — everybody can already use it."
    if row.owner_user_id != ctx.user.id:
        return f"{row.display_name} is not yours to lend."
    return str(row.plugin_id), str(row.display_name)


async def _allow(ctx: CommandContext) -> CommandResult:
    """Let somebody else command your agent in this channel.

    An owned agent answers its owner and nobody else, which is the point of owning one.
    This is how that bends without breaking — you say who, here, and you can take it back.
    """
    await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True
    )
    user_ids, _rest = await _resolve_people(ctx)
    if not user_ids:
        return CommandResult(ephemeral="Who? `/allow @agent @name` lends your agent to somebody.")

    found = await _agent_owner_and_bot(ctx, user_ids)
    if isinstance(found, str):
        return CommandResult(ephemeral=found)
    plugin_id, agent_name = found

    grantees = user_ids[1:]
    if not grantees:
        current = await agent_access.listeners(
            ctx.session, plugin_id=plugin_id, channel_id=ctx.channel_id
        )
        if not current:
            return CommandResult(ephemeral=f"Only you can command {agent_name}.")
        names = ", ".join(name for name, _ in current)
        return CommandResult(ephemeral=f"{agent_name} also answers {names} here.")

    for grantee in grantees:
        await agent_access.grant(
            ctx.session,
            workspace_id=ctx.user.workspace_id,
            plugin_id=plugin_id,
            grantee_user_id=grantee,
            granted_by=ctx.user.id,
            channel_id=ctx.channel_id,
        )
    count = len(grantees)
    return CommandResult(
        ephemeral=(
            f"{agent_name} now answers {count} more {'person' if count == 1 else 'people'} "
            "in this channel. `/disallow` takes it back."
        )
    )


async def _disallow(ctx: CommandContext) -> CommandResult:
    """Take back what `/allow` gave."""
    await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True
    )
    user_ids, _rest = await _resolve_people(ctx)
    if not user_ids:
        return CommandResult(ephemeral="Who? `/disallow @agent @name`.")

    found = await _agent_owner_and_bot(ctx, user_ids)
    if isinstance(found, str):
        return CommandResult(ephemeral=found)
    plugin_id, agent_name = found

    grantees = user_ids[1:]
    if not grantees:
        return CommandResult(ephemeral=f"Who should stop commanding {agent_name}?")

    ended = 0
    for grantee in grantees:
        ended += await agent_access.revoke(
            ctx.session,
            plugin_id=plugin_id,
            grantee_user_id=grantee,
            channel_id=ctx.channel_id,
        )
    if ended == 0:
        return CommandResult(ephemeral=f"They could not command {agent_name} anyway.")
    return CommandResult(ephemeral=f"{agent_name} answers only you here again.")


async def _remove(ctx: CommandContext) -> CommandResult:
    """Slack calls it `/remove`, and `/kick` is the alias everybody actually types."""
    access = await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True, require_writable=True
    )
    if access.kind in ("dm", "group_dm"):
        return CommandResult(ephemeral="Nobody can be removed from a direct message.")

    user_ids, _rest = await _resolve_people(ctx)
    if not user_ids:
        return _nobody(ctx, "remove")
    if ctx.user.id in user_ids:
        return CommandResult(ephemeral="Use `/leave` to leave a channel yourself.")

    here = set(await channel_service.member_ids(ctx.session, ctx.channel_id))
    leaving = [user_id for user_id in user_ids if user_id in here]
    if not leaving:
        return CommandResult(ephemeral="They aren't in this channel.")

    for user_id in leaving:
        await channel_service.leave(ctx.session, ctx.channel_id, user_id)
    return CommandResult(
        ephemeral=f"Removed {len(leaving)} {'person' if len(leaving) == 1 else 'people'}.",
        removed_user_ids=leaving,
    )


async def _join(ctx: CommandContext) -> CommandResult:
    """`/join #general` — by name, because that is what somebody knows a channel by."""
    wanted = ctx.args.strip().lstrip("#").strip()
    if not wanted:
        return CommandResult(ephemeral="Which channel? `/join #name`.")

    row = (
        await ctx.session.execute(
            text(
                """
                SELECT id FROM channels
                 WHERE workspace_id = :ws AND kind = 'public'
                   AND lower(name) = lower(:name) AND archived_at IS NULL
                """
            ),
            {"ws": ctx.user.workspace_id, "name": wanted},
        )
    ).fetchone()
    # A private channel answers exactly the same way a missing one does: its existence
    # is the private part.
    if row is None:
        return CommandResult(ephemeral=f"There's no open channel called #{wanted}.")

    channel_id = str(row.id)
    already = ctx.user.id in set(await channel_service.member_ids(ctx.session, channel_id))
    if not already:
        await channel_service.join(ctx.session, channel_id, ctx.user.id)
    channel = await channel_service.get_for_user(ctx.session, channel_id, ctx.user.id)
    return CommandResult(
        ephemeral=None if channel is not None else f"Couldn't open #{wanted}.",
        open_channel=channel,
        added_user_ids=[] if already else [ctx.user.id],
    )


async def _rename(ctx: CommandContext) -> CommandResult:
    access = await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True, require_writable=True
    )
    if access.kind in ("dm", "group_dm"):
        return CommandResult(ephemeral="A direct message is named after the people in it.")

    wanted = ctx.args.strip().lstrip("#").strip()
    if not wanted:
        return CommandResult(ephemeral="What should it be called? `/rename <name>`.")

    # The same rule the REST route enforces through its schema, borrowed rather than
    # restated — a command that accepted a name the console refuses would be two rules.
    try:
        name = ChannelNameMixin._check_channel_name(wanted)
    except ValueError as refusal:
        return CommandResult(ephemeral=str(refusal))

    try:
        await ctx.session.execute(
            text("UPDATE channels SET name = :name WHERE id = :id"),
            {"name": name, "id": ctx.channel_id},
        )
        await ctx.session.flush()
    except IntegrityError:
        # Flushed here deliberately: without it the violation surfaces at COMMIT, past
        # every handler, and answers 500 instead of a sentence.
        return CommandResult(ephemeral=f"There's already a channel called #{name}.")

    channel = await channel_service.get_for_user(ctx.session, ctx.channel_id, ctx.user.id)
    return CommandResult(ephemeral=f"Renamed to #{name}.", channel=channel)


async def _mute(ctx: CommandContext) -> CommandResult:
    """Toggle, like `/away`, because that is what the word means when you type it."""
    await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True
    )
    current = (
        await ctx.session.execute(
            text(
                "SELECT notify_level FROM channel_members"
                " WHERE channel_id = :channel_id AND user_id = :user_id"
            ),
            {"channel_id": ctx.channel_id, "user_id": ctx.user.id},
        )
    ).scalar_one_or_none()
    muting = current != "none"

    await ctx.session.execute(
        text(
            "UPDATE channel_members SET notify_level = :level"
            " WHERE channel_id = :channel_id AND user_id = :user_id"
        ),
        {
            # Back to the default, not to the loudest. `notify_level` defaults to
            # "mentions", so writing "all" on the way out left somebody who muted and
            # changed their mind noisier than they started — and the toggle gives them
            # nowhere to say otherwise.
            "level": "none" if muting else DEFAULT_NOTIFY_LEVEL,
            "channel_id": ctx.channel_id,
            "user_id": ctx.user.id,
        },
    )
    channel = await channel_service.get_for_user(ctx.session, ctx.channel_id, ctx.user.id)
    return CommandResult(
        ephemeral="Muted. You'll still see it, you just won't be told." if muting else "Unmuted.",
        own_channel=channel,
    )


async def _archive(ctx: CommandContext) -> CommandResult:
    """Archive this channel — admins only, and there is no way back.

    The gate matters more here than anywhere else in this file. Archiving cannot be
    undone: no route, no command and no console control sets `archived_at` back to null,
    so a member who typed eight characters would have closed the channel for everybody
    permanently. `ChannelMenu` has always hidden the row from members, but a hidden
    button is a client's opinion — this is the rule.
    """
    access = await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True
    )
    if access.kind in ("dm", "group_dm"):
        return CommandResult(ephemeral="A direct message cannot be archived.")
    if not ctx.user.is_admin:
        return CommandResult(
            ephemeral="Only an admin can archive a channel, and it cannot be undone."
        )

    await ctx.session.execute(
        text("UPDATE channels SET archived_at = now() WHERE id = :id"), {"id": ctx.channel_id}
    )
    return CommandResult(ephemeral="Archived. Nothing more can be posted here.", archived=True)


async def _who(ctx: CommandContext) -> CommandResult:
    """Who is in this channel — the question the members button answers in two clicks."""
    await channel_service.assert_channel_access(ctx.session, ctx.user.id, ctx.channel_id)
    ids = await channel_service.member_ids(ctx.session, ctx.channel_id)
    if not ids:
        return CommandResult(ephemeral="Nobody is in this channel.")

    rows = (
        await ctx.session.execute(
            text(
                """
                SELECT display_name FROM users
                 WHERE id = ANY(cast(:ids AS uuid[]))
                 ORDER BY lower(display_name)
                 LIMIT 100
                """
            ),
            {"ids": ids},
        )
    ).fetchall()
    names = ", ".join(row.display_name for row in rows)
    more = "" if len(rows) >= len(ids) else f" (and {len(ids) - len(rows)} more)"
    return CommandResult(ephemeral=f"{len(ids)} here: {names}{more}")


async def _dm(ctx: CommandContext) -> CommandResult:
    """`/dm @Ana are you free?` — open the conversation, and say the thing if one is given.

    Group DMs fall out of naming more than one person, which is what Slack does and what
    `find_or_create_dm` already supports: the same member set always returns the same
    channel, so this is idempotent whether it opens one or finds it.
    """
    user_ids, body = await _resolve_people(ctx)
    if not user_ids:
        return _nobody(ctx, "dm")

    members = list(dict.fromkeys([ctx.user.id, *user_ids]))
    # The same cap `CreateDmInput` puts on the REST route. A group message is a group of
    # people who can all see each other; without this, `/dm @everyone` — a handle that
    # resolves to a group — builds a conversation nobody can leave, because a DM has no
    # leave.
    if len(members) > MAX_DM_MEMBERS:
        return CommandResult(
            ephemeral=f"A group message holds {MAX_DM_MEMBERS} people. "
            "Make a channel for more than that."
        )

    channel_id, created = await channel_service.find_or_create_dm(
        ctx.session, ctx.user.workspace_id, members
    )
    channel = await channel_service.get_for_user(ctx.session, channel_id, ctx.user.id)

    message = None
    thread_update = None
    if body:
        result = await message_service.send(
            ctx.session,
            workspace_id=ctx.user.workspace_id,
            channel_id=channel_id,
            author_id=ctx.user.id,
            body=body,
            client_msg_id=ctx.client_msg_id,
        )
        message, thread_update = result.message, result.thread_update

    return CommandResult(
        open_channel=channel,
        # Everyone in it, not only the person who typed the command. Telling the invoker
        # alone left the other side with no DM row and no message until they reloaded —
        # their socket was never subscribed to a channel that did not exist when it
        # connected. `POST /api/dms` has always told every member; this had not.
        open_channel_members=members if created else [],
        # Deliberately not returned as `message`: it belongs to the DM, and the router
        # broadcasts `message` into the channel the command was *run* in.
        dm_message=message,
        dm_thread_update=thread_update,
        dm_channel_id=channel_id,
    )


async def _remind(ctx: CommandContext) -> CommandResult:
    """`/remind me to water the plants tomorrow at 9`.

    A scheduled message to yourself, in the conversation you have with yourself — see
    `services/reminders` for why that is the design rather than a workaround.
    """
    said, channel = await reminder_service.create(
        ctx.session,
        workspace_id=ctx.user.workspace_id,
        user_id=ctx.user.id,
        args=ctx.args,
    )
    return CommandResult(ephemeral=said, open_channel=channel, navigate=False)


async def _status(ctx: CommandContext) -> CommandResult:
    """`/status :palm_tree: on holiday`, and `/status clear` to take it down."""
    args = ctx.args.strip()
    if args.lower() in ("", "clear", "off", "none"):
        emoji, message = None, ""
    else:
        emoji, message = _split_status(args)

    if emoji is not None and len(emoji) > MAX_STATUS_EMOJI:
        return CommandResult(ephemeral="That emoji is too long to be one.")
    if len(message) > MAX_STATUS_TEXT:
        return CommandResult(ephemeral=f"A status is {MAX_STATUS_TEXT} characters or fewer.")

    await ctx.session.execute(
        text(
            "UPDATE users SET status_emoji = :emoji, status_text = :text,"
            # Cleared, not left. An expiry from a status set earlier in the day belongs to
            # *that* status; leaving it made a new one arrive already expired — accepted,
            # announced over the socket, and invisible to everybody including its author.
            " status_expires_at = NULL WHERE id = :id"
        ),
        {"emoji": emoji, "text": message or None, "id": ctx.user.id},
    )
    row = (
        await ctx.session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": ctx.user.id}
        )
    ).fetchone()
    updated = to_user(row) if row is not None else None

    if emoji is None and not message:
        return CommandResult(ephemeral="Status cleared.", user=updated)
    shown = " ".join(part for part in (emoji, message) if part)
    return CommandResult(ephemeral=f"Status set to {shown}", user=updated)


def _split_status(args: str) -> tuple[str | None, str]:
    """A leading `:shortcode:` is the emoji; the rest is the words."""
    if args.startswith(":"):
        _, found, rest = args[1:].partition(":")
        if found:
            return f":{args[1:].partition(':')[0]}:", rest.strip()
    return None, args


async def _leave(ctx: CommandContext) -> CommandResult:
    access = await channel_service.assert_channel_access(
        ctx.session, ctx.user.id, ctx.channel_id, require_member=True
    )
    if access.kind in ("dm", "group_dm"):
        return CommandResult(ephemeral="You can't leave a direct message.")

    await channel_service.leave(ctx.session, ctx.channel_id, ctx.user.id)
    return CommandResult(ephemeral="You left the channel.", left_channel=True)


async def _away(ctx: CommandContext) -> CommandResult:
    """Flip presence.

    The state itself lives in Redis and announces its own change, so unlike the others
    this one has nothing for the router to broadcast beyond what presence already does.
    """
    current = (await presence.get_presence([ctx.user.id])).get(ctx.user.id)
    going_away = current != "away"
    return CommandResult(
        ephemeral="You're now away." if going_away else "You're back.",
        presence="away" if going_away else "active",
    )


COMMANDS: dict[str, Command] = {
    c.name: c
    for c in [
        Command("help", "", "List the commands this workspace knows.", _help),
        Command("shrug", "[text]", "Post a message with a shrug on the end.", _shrug, writes=True),
        Command("me", "<text>", "Post an action, in italics.", _me, writes=True),
        Command("topic", "[text]", "Set the channel topic, or clear it.", _topic, writes=True),
        Command("leave", "", "Leave this channel.", _leave),
        Command("away", "", "Toggle whether you show as away.", _away),
        Command("invite", "@name…", "Add people to this channel.", _invite),
        Command("remove", "@name…", "Take someone out of this channel.", _remove),
        Command("join", "#channel", "Join an open channel by name.", _join),
        Command("rename", "<name>", "Rename this channel.", _rename),
        Command("mute", "", "Toggle notifications for this channel.", _mute),
        Command("archive", "", "Archive this channel.", _archive),
        Command("who", "", "List who is in this channel.", _who),
        Command("dm", "@name [text]", "Open a direct message, and optionally say it.", _dm),
        Command("status", "[:emoji: text]", "Set your status, or clear it.", _status),
        Command("remind", "me to <text> <when>", "Send yourself a note later.", _remind),
        Command("allow", "@agent @name…", "Let somebody command your agent here.", _allow),
        Command("disallow", "@agent @name…", "Stop somebody commanding your agent.", _disallow),
    ]
}


@dataclass(slots=True)
class AppCommand:
    """An installed app's command, with everything needed to ask it."""

    plugin_id: str
    name: str
    request_url: str
    signing_secret: str
    bot_user_id: str


async def find_app_command(
    session: AsyncSession, workspace_id: str, name: str
) -> AppCommand | None:
    """The app that holds this name, if one does and is enabled.

    A disabled app keeps its name — uninstalling is how a name is released — but is not
    asked. From the person's side that is indistinguishable from the command not existing,
    which is the right answer: an app someone switched off should not still be answering.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT pc.plugin_id, pc.name, p.request_url, ps.signing_secret,
                       u.id AS bot_user_id
                  FROM plugin_commands pc
                  JOIN plugins p ON p.id = pc.plugin_id
                  JOIN plugin_secrets ps ON ps.plugin_id = pc.plugin_id
                  LEFT JOIN users u ON u.bot_plugin_id = pc.plugin_id
                 WHERE pc.workspace_id = :ws
                   AND pc.name = :name
                   AND p.status = 'enabled'
                """
            ),
            {"ws": workspace_id, "name": name},
        )
    ).fetchone()

    if row is None or not row.request_url or not row.bot_user_id:
        return None

    return AppCommand(
        plugin_id=row.plugin_id,
        name=row.name,
        request_url=row.request_url,
        signing_secret=row.signing_secret,
        bot_user_id=row.bot_user_id,
    )


async def app_specs(
    session: AsyncSession, workspace_id: str, actor_id: str
) -> list[tuple[str, str, str]]:
    """(name, usage, summary) for every app command this person can actually run.

    Filtered by ownership, because the list is what the composer offers and offering
    somebody a command that will answer "isn't a command here" is worse than not
    offering it. Delegation is checked without a channel: this list is workspace-wide,
    and a grant made in one channel still makes the command worth knowing about — the
    dispatch is where the channel is decided.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT pc.name, pc.usage, pc.summary
                  FROM plugin_commands pc
                  JOIN plugins p ON p.id = pc.plugin_id
                 WHERE pc.workspace_id = :ws AND p.status = 'enabled'
                   AND (p.owner_user_id IS NULL
                        OR p.owner_user_id = :actor_id
                        OR EXISTS (
                             SELECT 1 FROM agent_delegations d
                              WHERE d.plugin_id = p.id
                                AND d.grantee_user_id = :actor_id
                                AND d.revoked_at IS NULL
                           ))
                 ORDER BY pc.name
                """
            ),
            {"ws": workspace_id, "actor_id": actor_id},
        )
    ).fetchall()
    return [(r.name, r.usage, r.summary) for r in rows]


async def bot_is_member(session: AsyncSession, channel_id: str, bot_user_id: str) -> bool:
    """Whether an app has been added to this channel.

    An app answering where nobody invited it is a way into a conversation that was never
    granted, so this gates both asking and any deferred answer that arrives later — an
    app removed from a channel while it was thinking must not still land in it.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT 1 FROM channel_members
                 WHERE channel_id = :channel_id AND user_id = :user_id
                """
            ),
            {"channel_id": channel_id, "user_id": bot_user_id},
        )
    ).fetchone()
    return row is not None


async def bot_for_plugin(session: AsyncSession, plugin_id: str) -> tuple[str, str] | None:
    """(bot user id, workspace id) for an installed, enabled app."""
    row = (
        await session.execute(
            text(
                """
                SELECT u.id AS bot_user_id, p.workspace_id
                  FROM plugins p
                  JOIN users u ON u.bot_plugin_id = p.id
                 WHERE p.id = :id AND p.status = 'enabled'
                """
            ),
            {"id": plugin_id},
        )
    ).fetchone()
    return (row.bot_user_id, row.workspace_id) if row else None


def builtin_names() -> frozenset[str]:
    """Names an app may not claim.

    Passed down into the plugin layer at every install site rather than imported there:
    `plugins/` sits below `services/`, and a built-in command is a service's idea.
    """
    return frozenset(COMMANDS)


def ordered() -> list[Command]:
    """Commands for `/help`, alphabetically — the order a reader can predict."""
    return sorted(COMMANDS.values(), key=lambda c: c.name)


def parse(text_input: str) -> tuple[str, str] | None:
    """Split `/name rest` into its parts, or None when this is not a command at all.

    A lone `/` is not a command, and neither is `/ foo` — both are far more likely to be
    someone typing a path than reaching for a command, and treating them as commands
    would make a message starting with a slash impossible to send.
    """
    if not text_input.startswith("/"):
        return None

    head, _, rest = text_input[1:].partition(" ")
    name = head.strip().lower()
    if not name or not name.replace("_", "").replace("-", "").isalnum():
        return None
    return name, rest.strip()


async def run(ctx: CommandContext, name: str) -> CommandResult:
    command = COMMANDS.get(name)
    if command is None:
        return CommandResult(
            ephemeral=f"`/{name}` isn't a command here. Try `/help` to see what is."
        )

    if command.writes:
        await channel_service.assert_channel_access(
            ctx.session, ctx.user.id, ctx.channel_id, require_member=True, require_writable=True
        )

    return await command.handler(ctx)
