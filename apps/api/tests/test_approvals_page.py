"""What agents are waiting on, for an admin (the Approvals page).

A decision nobody has made, and a run that said it would come back (ADR 0040), across the
workspace: every one listed — which agent, where, for whom — as the run log lists every
run; what it asks or notes only where the admin can read the room.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from .helpers import send_message
from .test_agent_follows import say
from .test_agent_tools import calls
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module
from .test_task_dispatch import (
    STOPS_TO_ASK,
    desk_fixture,  # noqa: F401 — the fake agent and its room
)


async def pending(desk: dict[str, Any]) -> list[dict[str, Any]]:
    got = await desk["owner"].get("/api/admin/approvals")
    assert got.status == 200, got.body
    return list(got.body["pending"])


async def test_a_decision_waiting_on_somebody_is_listed_with_whom_and_where(
    desk: dict[str, Any],
) -> None:
    await say(desk, "@Helper draft the notes", STOPS_TO_ASK, who="member")

    [item] = await pending(desk)
    assert item["run"]["status"] == "interrupted"
    assert item["run"]["agentName"] == "Helper"
    assert item["personName"] == "Member"
    assert item["channelName"] == "general"
    assert item["visible"] is True
    assert item["run"]["decision"]["prompt"] == "Include the risks?"


async def test_a_private_rooms_question_is_kept_from_an_admin_not_in_it(
    desk: dict[str, Any],
) -> None:
    room = await desk["member"].post("/api/channels", {"name": "quiet-room", "kind": "private"})
    channel = room.body["channel"]["id"]
    added = await desk["member"].post(
        f"/api/channels/{channel}/members", {"userIds": [desk["bot"]]}
    )
    assert added.status == 200, added.body
    desk["state"]["scripts"] = [STOPS_TO_ASK]
    sent = await send_message(desk["member"], channel, "@Helper draft the notes")
    from blob_api.jobs import agui as agui_job

    await agui_job.handle_agui_run(str(sent.body["message"]["id"]))

    [item] = await pending(desk)
    assert item["channelName"] == "quiet-room"
    assert item["visible"] is False
    assert item["run"]["decision"] is None
    assert item["run"]["card"] is None
    assert "Include the risks?" not in str(item)


async def test_a_follow_up_is_listed_with_when_it_comes_back(desk: dict[str, Any]) -> None:
    granted = await desk["owner"].post(
        f"/api/admin/plugins/{desk['plugin_id']}/tools", {"access": "read"}
    )
    assert granted.status == 200, granted.body
    when = (datetime.now(UTC) + timedelta(hours=3)).isoformat()
    await say(
        desk,
        "@Helper tell me when the deploy is out",
        calls(("c1", "schedule_followup", {"when": when, "note": "check the deploy"})),
        who="member",
    )

    [item] = await pending(desk)
    assert item["run"]["status"] == "waiting"
    assert item["run"]["comesBackFor"] == "check the deploy"
    assert item["run"]["comesBackAt"].endswith("Z")


async def test_an_answered_decision_is_no_longer_listed(desk: dict[str, Any]) -> None:
    await say(desk, "@Helper draft the notes", STOPS_TO_ASK, who="member")
    [item] = await pending(desk)

    answered = await desk["member"].post(
        f"/api/agent-runs/{item['run']['id']}/answer", {"choice": 0}
    )

    assert answered.status == 200, answered.body
    assert await pending(desk) == []


async def test_it_is_an_admins_page(desk: dict[str, Any]) -> None:
    refused = await desk["member"].get("/api/admin/approvals")
    assert refused.status == 403
