"""Announcement channels and the @channel rule (M3 · B3).

An admins-only channel takes top-level posts from the workspace's admins and replies in
its threads from everybody; a workspace may keep @channel, @here and @everyone for its
admins. Both refuse with a sentence that says what to do instead, on every path a
person's message takes — sent now, scheduled, and sent later from the schedule.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio

from blob_api.db.engine import SessionFactory
from blob_api.lib.errors import AppError
from blob_api.services import scheduled as scheduled_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up

TOMORROW = (datetime.now(UTC) + timedelta(days=1)).isoformat()


@pytest_asyncio.fixture
async def room(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Olga Owner")
    member = await invite_and_sign_up(owner, "Max Member")
    made = await owner.post("/api/channels", {"name": "announcements", "kind": "public"})
    channel = made.body["channel"]["id"]
    await owner.post(f"/api/channels/{channel}/members", {"userIds": [member.user_id]})
    return {"owner": owner, "member": member, "channel": channel}


async def test_an_admin_makes_a_channel_admins_only_and_a_member_cannot(
    room: dict[str, Any],
) -> None:
    refused = await room["member"].patch(f"/api/channels/{room['channel']}", {"posting": "admins"})
    assert refused.status == 403
    made = await room["owner"].patch(f"/api/channels/{room['channel']}", {"posting": "admins"})
    assert made.status == 200, made.body
    assert made.body["channel"]["posting"] == "admins"


async def test_members_reply_in_threads_and_admins_post(room: dict[str, Any]) -> None:
    await room["owner"].patch(f"/api/channels/{room['channel']}", {"posting": "admins"})
    refused = await send_message(room["member"], room["channel"], "can I say something?")
    assert refused.status == 403
    assert refused.body["error"]["code"] == "posting_restricted"
    assert "Reply in a thread" in refused.body["error"]["message"]

    posted = await send_message(room["owner"], room["channel"], "Launch is on Friday.")
    assert posted.status == 201, posted.body
    reply = await send_message(
        room["member"],
        room["channel"],
        "Great news",
        threadRootId=posted.body["message"]["id"],
    )
    assert reply.status == 201, reply.body


async def test_scheduling_is_refused_now_and_a_schedule_that_turns_restricted_fails(
    room: dict[str, Any],
) -> None:
    scheduled = await room["member"].post(
        f"/api/channels/{room['channel']}/schedule",
        {
            "body": "tomorrow's note",
            "sendAt": TOMORROW,
            "clientMsgId": "sched-0001-abcdef",
        },
    )
    assert scheduled.status in (200, 201), scheduled.body
    await room["owner"].patch(f"/api/channels/{room['channel']}", {"posting": "admins"})

    again = await room["member"].post(
        f"/api/channels/{room['channel']}/schedule",
        {
            "body": "another",
            "sendAt": TOMORROW,
            "clientMsgId": "sched-0002-abcdef",
        },
    )
    assert again.status == 403

    item = {
        "author_id": room["member"].user_id,
        "workspace_id": (await room["member"].get("/api/bootstrap")).body["workspace"]["id"],
        "channel_id": room["channel"],
        "body": "tomorrow's note",
        "client_msg_id": "sched-0001-abcdef",
        "thread_root_id": None,
    }
    async with SessionFactory() as session, session.begin():
        with pytest.raises(AppError) as refusal:
            await scheduled_service.deliver(session, item)
    assert refusal.value.code == "posting_restricted"


async def test_the_workspace_may_keep_at_channel_for_its_admins(room: dict[str, Any]) -> None:
    # Anyone may, until the workspace says otherwise.
    allowed = await send_message(room["member"], room["channel"], "@channel heads up")
    assert allowed.status == 201, allowed.body
    assert (await room["member"].get("/api/bootstrap")).body["everyoneMentions"] == "everyone"

    saved = await room["owner"].patch(
        "/api/admin/settings", {"settings": {"everyoneMentions": "admins"}}
    )
    assert saved.status == 200, saved.body
    assert (await room["member"].get("/api/bootstrap")).body["everyoneMentions"] == "admins"

    for body in ("@channel heads up", "@here anyone?", "@everyone hi"):
        refused = await send_message(room["member"], room["channel"], body)
        assert refused.status == 403, body
        assert refused.body["error"]["code"] == "mention_restricted"
    plain = await send_message(room["member"], room["channel"], "no broadcast here")
    assert plain.status == 201
    admin = await send_message(room["owner"], room["channel"], "@channel all hands at 3")
    assert admin.status == 201, admin.body
