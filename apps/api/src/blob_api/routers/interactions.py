"""Someone pressed a button.

The whole security story is one check: the `actionId` must appear in the blocks stored
on that message. The server holds those blocks, so a client cannot invent an action, and
an app can never be handed an id it did not publish. Everything else here — that the
message exists, that the person can see its channel — is the ordinary permission work
every route does.

The interaction is delivered through the same outbox as every other event, so an app
that is down gets it on retry rather than losing it, and a slow app cannot make the
person's click hang.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import text

from ..db.engine import transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request, not_found
from ..lib.queue import enqueue, fire_and_forget
from ..lib.rate_limit import consume
from ..plugins import events as plugin_events
from ..plugins.blocks import action_ids_of
from ..schemas.base import CamelModel
from ..services import channels as channel_service

router = APIRouter(tags=["interactions"])


class InteractionInput(CamelModel):
    message_id: str
    action_id: str
    #: What the element carried — a button's value, or the option a select chose.
    value: str = ""


class OkOut(CamelModel):
    ok: bool = True


@router.post("/api/interactions", response_model=OkOut)
async def interact(
    payload: InteractionInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    await consume("interaction", user.id)

    async with transaction() as (session, after):
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, channel_id, blocks, plugin_id, deleted_at
                      FROM messages
                     WHERE id = :id AND workspace_id = :ws
                    """
                ),
                {"id": payload.message_id, "ws": user.workspace_id},
            )
        ).fetchone()

        if row is None or row.deleted_at is not None:
            raise not_found("That message is gone.")

        # Being able to press the button requires being able to see the message.
        await channel_service.assert_channel_access(session, user.id, str(row.channel_id))

        if payload.action_id not in action_ids_of(row.blocks):
            # Deliberately not "unknown action": whether an id exists on a message the
            # caller can see is not worth leaking a distinction over.
            raise bad_request("That action is not available.", code="unknown_action")

        if not row.plugin_id:
            raise bad_request("Nothing is listening for that action.", code="no_listener")

        await plugin_events.emit(
            session,
            workspace_id=user.workspace_id,
            event="interaction.triggered",
            channel_id=str(row.channel_id),
            payload={
                "messageId": str(row.id),
                "channelId": str(row.channel_id),
                "actionId": payload.action_id,
                "value": payload.value[:500],
                "userId": user.id,
            },
            only_plugin_id=str(row.plugin_id),
        )

        after.add(lambda: fire_and_forget(enqueue("deliver_plugin_events")))

    return OkOut()


__all__ = ["router"]
