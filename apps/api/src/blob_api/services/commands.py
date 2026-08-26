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
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser
from ..realtime import presence
from ..schemas.models import ChannelWithState, Message
from . import channels as channel_service
from . import messages as message_service

#: What a command may ask the router to do once the transaction has committed.
Presence = Literal["active", "away"]


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


async def app_specs(session: AsyncSession, workspace_id: str) -> list[tuple[str, str, str]]:
    """(name, usage, summary) for every app command, for the composer's list."""
    rows = (
        await session.execute(
            text(
                """
                SELECT pc.name, pc.usage, pc.summary
                  FROM plugin_commands pc
                  JOIN plugins p ON p.id = pc.plugin_id
                 WHERE pc.workspace_id = :ws AND p.status = 'enabled'
                 ORDER BY pc.name
                """
            ),
            {"ws": workspace_id},
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
