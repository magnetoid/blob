"""Slash command dispatch.

One endpoint for every command, built-in or provided by an app. The service decides what
a command *did*; this file is what tells the workspace about it, after the transaction has
committed and not before.

The ephemeral half of a response needs no socket event and deliberately so. It is a reply
to a request the invoker just made, so it travels back down the same HTTP call that
carried the command up. An event would mean inventing a delivery path whose only
subscriber is the person already holding the response.

An app command is asked over the network, and that call is made with **no transaction
open**. Holding one across a request to somebody else's server is how a slow app becomes
a database problem — the connection is pinned, the locks are held, and the app's timeout
becomes the workspace's. So the flow is: read what is needed, close; ask the app; open a
new transaction only if there is something to write.
"""

from __future__ import annotations

import hashlib
import json

from fastapi import APIRouter, Depends

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request
from ..lib.queue import enqueue, fire_and_forget
from ..lib.rate_limit import consume
from ..plugins import commands as app_transport
from ..plugins import events as plugin_events
from ..realtime import hub, presence
from ..schemas.base import CamelModel
from ..schemas.models import ChannelWithState, Message
from ..schemas.requests import RunCommandInput
from ..services import channels as channel_service
from ..services import commands as command_service
from ..services import messages as message_service
from ..services.serialize import message_event

router = APIRouter()


class CommandOut(CamelModel):
    """What the invoker sees.

    `message` is the same shape a send returns, so the client's optimistic path is the
    one it already has. `ephemeral` is shown to this person and never stored.
    """

    ephemeral: str | None = None
    message: Message | None = None
    #: A channel the invoker should be taken to — `/join`. The socket delivers the row;
    #: this says which one to open, because a command that joins somewhere and leaves
    #: them looking at where they were is a command they have to follow up by hand.
    channel: ChannelWithState | None = None


def _response_url(token: str) -> str:
    return f"{settings.PUBLIC_URL.rstrip('/')}/api/hooks/commands/{token}"


@router.post("/api/commands", response_model=CommandOut)
async def run_command(
    payload: RunCommandInput,
    user: SessionUser = Depends(current_user),
) -> CommandOut:
    await consume("command", user.id)

    parsed = command_service.parse(payload.text)
    if parsed is None:
        # The client only routes here when it believes it has a command, so this is a
        # client bug rather than a typo — a typo reaches the dispatch below and gets an
        # ephemeral no.
        raise bad_request("That isn't a command.", code="invalid_input")

    name, args = parsed

    if name not in command_service.COMMANDS:
        return await _run_app_command(payload, user, name=name, args=args)

    async with transaction() as (session, after_commit):
        ctx = command_service.CommandContext(
            session=session,
            user=user,
            channel_id=payload.channel_id,
            args=args,
            client_msg_id=payload.client_msg_id,
        )
        result = await command_service.run(ctx, name)

        if result.message is not None:
            # Inside the transaction, like every other message write: the outbox row and
            # the message it describes commit together or not at all.
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="message.created",
                channel_id=payload.channel_id,
                payload=result.message.model_dump(by_alias=True),
            )

        if result.left_channel:
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="member.left",
                channel_id=payload.channel_id,
                payload={"channelId": payload.channel_id, "userId": user.id},
            )

        # A membership change through a command is the same event a membership change
        # through the console is. Emitted here, inside the transaction, like every other
        # outbox write — and scoped to the channel it happened in.
        joined_channel_id = (
            result.open_channel.id if result.open_channel is not None else payload.channel_id
        )
        for member_id in result.added_user_ids:
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="member.joined",
                channel_id=joined_channel_id,
                payload={"channelId": joined_channel_id, "userId": member_id},
            )
        for member_id in result.removed_user_ids:
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="member.left",
                channel_id=payload.channel_id,
                payload={"channelId": payload.channel_id, "userId": member_id},
            )

        if result.dm_message is not None and result.dm_channel_id is not None:
            await plugin_events.emit(
                session,
                workspace_id=user.workspace_id,
                event="message.created",
                channel_id=result.dm_channel_id,
                payload=result.dm_message.model_dump(by_alias=True),
            )

        # Each new member's own view of the channel, read while the session is open so
        # the sidebar has the row before anything asks it to render one.
        joined_views = {
            member_id: await channel_service.get_for_user(session, joined_channel_id, member_id)
            for member_id in result.added_user_ids
            if member_id != user.id
        }
        # And the same for the other side of a conversation this command created. Their
        # socket subscribed at connect time to channels that existed then, so a DM made a
        # moment ago reaches them only if it is subscribed now.
        opened = result.open_channel
        opened_views = (
            {
                member_id: await channel_service.get_for_user(session, opened.id, member_id)
                for member_id in result.open_channel_members
                if member_id != user.id
            }
            if opened is not None
            else {}
        )

        def broadcast() -> None:
            channel_id = payload.channel_id

            if result.message is not None:
                hub.to_channel(channel_id, message_event("message.new", result.message))
                if result.thread_update:
                    hub.to_channel(channel_id, result.thread_update.as_event())
                fire_and_forget(enqueue("notify", result.message.id))
                if result.message.mention_user_ids:
                    fire_and_forget(enqueue("agui_run", result.message.id))

            if result.channel is not None:
                hub.to_channel(
                    channel_id,
                    {"t": "channel.updated", "channel": result.channel.model_dump(by_alias=True)},
                )

            if result.left_channel:
                # Unsubscribe first: the member.left that follows is for the people still
                # in the channel, and this connection is no longer one of them.
                hub.unsubscribe_users([user.id], [channel_id])
                hub.to_channel(
                    channel_id,
                    {"t": "member.left", "channelId": channel_id, "userId": user.id},
                )

            for member_id, view in joined_views.items():
                hub.to_channel(
                    joined_channel_id,
                    {"t": "member.joined", "channelId": joined_channel_id, "userId": member_id},
                )
                # Existing sockets have to start receiving the channel's events, wherever
                # they are held — the command may have landed on a sibling process.
                hub.subscribe_users([member_id], [joined_channel_id])
                if view is not None:
                    hub.to_users(
                        [member_id],
                        {"t": "channel.created", "channel": view.model_dump(by_alias=True)},
                    )

            for member_id in result.removed_user_ids:
                # Unsubscribe first: the member.left that follows is for the people still
                # in the channel, and they are no longer one of them.
                hub.unsubscribe_users([member_id], [channel_id])
                hub.to_channel(
                    channel_id,
                    {"t": "member.left", "channelId": channel_id, "userId": member_id},
                )

            for member_id, view in opened_views.items():
                assert opened is not None  # opened_views is empty otherwise
                hub.subscribe_users([member_id], [opened.id])
                if view is not None:
                    hub.to_users(
                        [member_id],
                        {"t": "channel.created", "channel": view.model_dump(by_alias=True)},
                    )

            if opened is not None:
                hub.subscribe_users([user.id], [opened.id])
                hub.to_users(
                    [user.id],
                    {"t": "channel.created", "channel": opened.model_dump(by_alias=True)},
                )
                if user.id in result.added_user_ids:
                    hub.to_channel(
                        opened.id,
                        {"t": "member.joined", "channelId": opened.id, "userId": user.id},
                    )

            if result.dm_message is not None and result.dm_channel_id is not None:
                # Into the DM, not into the channel the command was typed in. Everything
                # a send does, because it *is* a send: the frame, the notification, and
                # the agent run if the message named one.
                hub.to_channel(
                    result.dm_channel_id, message_event("message.new", result.dm_message)
                )
                if result.dm_thread_update:
                    hub.to_channel(result.dm_channel_id, result.dm_thread_update.as_event())
                fire_and_forget(enqueue("notify", result.dm_message.id))
                if result.dm_message.mention_user_ids:
                    fire_and_forget(enqueue("agui_run", result.dm_message.id))

            if result.own_channel is not None:
                # Only to them: how loud a channel is for one person is nobody else's
                # business, unlike `channel`, which goes to everyone in it.
                hub.to_users(
                    [user.id],
                    {
                        "t": "channel.updated",
                        "channel": result.own_channel.model_dump(by_alias=True),
                    },
                )

            if result.user is not None:
                changed = result.user
                hub.to_workspace(
                    user.workspace_id,
                    {"t": "user.updated", "user": changed.model_dump(by_alias=True)},
                )

            if result.archived:
                hub.to_channel(channel_id, {"t": "channel.archived", "channelId": channel_id})

            if result.added_user_ids or result.removed_user_ids:
                fire_and_forget(enqueue("deliver_plugin_events"))

            if result.presence == "away":
                fire_and_forget(presence.mark_away(user.id))
            elif result.presence == "active":
                fire_and_forget(presence.mark_active(user.id))

        after_commit.add(broadcast)

    return CommandOut(
        ephemeral=result.ephemeral,
        message=result.message,
        # Told about, but only taken there when the command meant it.
        channel=result.open_channel if result.navigate else None,
    )


async def _run_app_command(
    payload: RunCommandInput, user: SessionUser, *, name: str, args: str
) -> CommandOut:
    """Ask an app, then write whatever it said."""
    async with session_scope() as session:
        await channel_service.assert_channel_access(
            session, user.id, payload.channel_id, require_member=True, require_writable=True
        )
        app = await command_service.find_app_command(session, user.workspace_id, name)
        if app is None:
            return CommandOut(
                ephemeral=f"`/{name}` isn't a command here. Try `/help` to see what is."
            )

        in_channel = await command_service.bot_is_member(
            session, payload.channel_id, app.bot_user_id
        )

    if not in_channel:
        # Slack's rule, for Slack's reason: an app answering in a channel nobody added it
        # to is a way into a conversation that was never granted.
        return CommandOut(ephemeral=f"`/{name}` needs its app added to this channel first.")

    token = app_transport.response_token(
        plugin_id=app.plugin_id, channel_id=payload.channel_id, user_id=user.id
    )
    reply, error = await app_transport.ask(
        url=app.request_url,
        secret=app.signing_secret,
        payload={
            "type": "command",
            "command": f"/{name}",
            "text": args,
            "workspaceId": user.workspace_id,
            "channelId": payload.channel_id,
            "userId": user.id,
            "userName": user.display_name,
            "responseUrl": _response_url(token),
        },
    )

    if reply is None:
        # Covers a timeout, a 202, and an app that answered with nothing. All three mean
        # the same thing to the person waiting, and the app still holds its responseUrl.
        # An app that is genuinely broken is a matter for the delivery log, not for a
        # stack trace shown under the composer.
        return CommandOut(
            ephemeral="Working on it — the app will answer here when it's ready."
            if error is None or error == "timeout"
            else f"`/{name}` couldn't be reached."
        )

    if reply.response_type == "ephemeral":
        return CommandOut(ephemeral=reply.text)

    message = await _post_as_bot(
        workspace_id=user.workspace_id,
        channel_id=payload.channel_id,
        bot_user_id=app.bot_user_id,
        body=reply.text,
        client_msg_id=payload.client_msg_id,
    )
    return CommandOut(message=message)


async def _post_as_bot(
    *,
    workspace_id: str,
    channel_id: str,
    bot_user_id: str,
    body: str,
    client_msg_id: str,
) -> Message:
    """Write an app's in-channel answer, then broadcast it once committed."""
    async with transaction() as (session, after_commit):
        result = await message_service.send(
            session,
            workspace_id=workspace_id,
            channel_id=channel_id,
            author_id=bot_user_id,
            body=body,
            client_msg_id=client_msg_id,
            kind="bot",
        )

        def broadcast() -> None:
            hub.to_channel(channel_id, message_event("message.new", result.message))
            if result.thread_update:
                hub.to_channel(channel_id, result.thread_update.as_event())
            fire_and_forget(enqueue("notify", result.message.id))

        after_commit.add(broadcast)

    return result.message


@router.post("/api/hooks/commands/{token}", response_model=CommandOut)
async def deferred_response(token: str, body: dict[str, object]) -> CommandOut:
    """An app answering a command it took too long to answer inline.

    Under `/api/hooks/` because that prefix is exactly this shape already: a URL that
    carries its own credential and is called by something that holds no session. The
    token names the app, the channel and the person, so a leaked one cannot be pointed
    somewhere else.

    Refusals are deliberately uniform. A forged token, an expired one and one for an app
    since uninstalled all answer the same way, because distinguishing them tells whoever
    is probing which half of the token to keep working on.
    """
    target = app_transport.verify_response_token(token)
    if target is None:
        raise bad_request("That response link is not valid.", code="invalid_input")

    reply = app_transport.parse_reply(200, json.dumps(body).encode())
    if reply is None:
        raise bad_request("A response needs text.", code="invalid_input")

    async with session_scope() as session:
        bot = await command_service.bot_for_plugin(session, target.plugin_id)
        if bot is None:
            raise bad_request("That response link is not valid.", code="invalid_input")
        bot_user_id, workspace_id = bot
        still_a_member = await command_service.bot_is_member(
            session, target.channel_id, bot_user_id
        )

    if not still_a_member:
        raise bad_request("That response link is not valid.", code="invalid_input")

    if reply.response_type == "ephemeral":
        # There is nowhere to put it. The person who ran the command has long since had
        # their answer ("working on it"), and an ephemeral has no delivery path of its
        # own — inventing one for this single case would mean a socket event whose only
        # purpose is a late private note. An app that needs to be seen answers in channel.
        return CommandOut(ephemeral=reply.text)

    # Keyed on the token *and* what was said. An app is allowed several deferred answers
    # to one command, so the token alone would collapse them into the first; the body
    # alone would collapse two commands that happened to produce the same text. Together
    # they make a retry idempotent and two genuinely different answers two messages.
    digest = hashlib.sha256(f"{token}:{reply.text}".encode()).hexdigest()[:32]
    message = await _post_as_bot(
        workspace_id=workspace_id,
        channel_id=target.channel_id,
        bot_user_id=bot_user_id,
        body=reply.text,
        client_msg_id=f"cmd-{digest}",
    )
    return CommandOut(message=message)
