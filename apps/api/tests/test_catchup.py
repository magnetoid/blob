"""Catch Me Up: ephemeral summaries of the unread, bounded and boundary-checked."""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio

from blob_api.lib import llm

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    secret = (
        await owner.post(
            "/api/channels",
            {"name": "war-room", "kind": "private", "memberIds": [member.user_id]},
        )
    ).body["channel"]
    return {
        "owner": owner,
        "member": member,
        "outsider": outsider,
        "general": general["id"],
        "secret": secret["id"],
    }


@pytest.fixture
def model_speaks(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """A model that answers instantly and records what it was asked."""
    calls: list[dict[str, Any]] = []

    async def fake_stream(*, system: str, turns: Any, max_tokens: int | None = None) -> Any:
        calls.append({"system": system, "turns": turns})
        yield "Ana shipped the release; Bo asked for a review."

    monkeypatch.setattr(llm, "configured", lambda: True)
    monkeypatch.setattr(llm, "stream_reply", fake_stream)
    return calls


class TestCatchup:
    async def test_a_channel_with_unread_gets_a_summary(
        self, team: dict, model_speaks: list
    ) -> None:
        await send_message(team["owner"], team["general"], "the release shipped")
        response = await team["member"].post("/api/catchup", {"channelId": team["general"]})
        assert response.status == 200, response.body
        (summary,) = response.body["summaries"]
        assert "Ana shipped" in summary["text"]
        assert summary["messageCount"] >= 1
        assert summary["upToMessageId"]

    async def test_nothing_unread_means_no_summaries_and_no_model_call(
        self, team: dict, model_speaks: list
    ) -> None:
        sent = await send_message(team["owner"], team["general"], "hello")
        marked = await team["member"].post(
            f"/api/channels/{team['general']}/read",
            {"lastReadMessageId": sent.body["message"]["id"]},
        )
        assert marked.status == 200, marked.body
        response = await team["member"].post("/api/catchup", {"channelId": team["general"]})
        assert response.status == 200
        assert response.body["summaries"] == []
        assert model_speaks == []

    async def test_a_channel_you_cannot_see_is_a_404(
        self, team: dict, model_speaks: list
    ) -> None:
        response = await team["outsider"].post("/api/catchup", {"channelId": team["secret"]})
        assert response.status == 404
        assert model_speaks == []

    async def test_the_workspace_form_never_reads_channels_you_are_not_in(
        self, team: dict, model_speaks: list
    ) -> None:
        await send_message(team["owner"], team["secret"], "the secret plan moves tonight")
        response = await team["outsider"].post("/api/catchup", {})
        assert response.status == 200
        # Membership lives inside the statement: the private channel simply is not there.
        assert all(s["channelId"] != team["secret"] for s in response.body["summaries"])
        for call in model_speaks:
            assert "secret plan" not in str(call["turns"])

    async def test_no_model_is_a_clean_refusal(self, team: dict, monkeypatch) -> None:
        monkeypatch.setattr(llm, "configured", lambda: False)
        await send_message(team["owner"], team["general"], "something")
        response = await team["member"].post("/api/catchup", {})
        assert response.status == 400
        assert response.body["error"]["code"] == "llm_not_configured"
