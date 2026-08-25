"""The agent Blob runs itself.

Blob had spoken AG-UI for a long time as the *client*, and had no agent of its own: a
fresh workspace had none until somebody wrote a server, deployed it and paid for a key.
These cover the three parts of closing that — the model layer, the in-process AG-UI
server, and the seeding that means a founder does not have to do anything at all.

The thing most worth pinning is that this is a *plugin*, not a special case. It holds
scopes, it can be disabled, its runs land in the run log with the rest, and a manifest
off the wire cannot claim its runtime — which matters because that runtime spends the
server's own model budget rather than the caller's.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.lib import llm
from blob_api.plugins import builtin
from blob_api.services import workspace_agent

from .helpers import Client, send_message, sign_up, workspace_id_of
from .test_agui import team  # noqa: F401 — a fixture, used by name


def sse(*events: dict[str, Any]) -> bytes:
    return b"".join(f"data: {json.dumps(e)}\n\n".encode() for e in events)


def anthropic_says(*texts: str, status: int = 200, body: bytes = b"") -> httpx.MockTransport:
    """A fake Anthropic streaming endpoint."""

    def handler(request: httpx.Request) -> httpx.Response:
        if status >= 400:
            return httpx.Response(status, content=body or b'{"error":{"message":"nope"}}')
        events = [
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": t}}
            for t in texts
        ]
        return httpx.Response(200, content=sse(*events, {"type": "message_stop"}))

    return httpx.MockTransport(handler)


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> dict:
    """A configured model whose answer the test chooses.

    `llm.open_client` is patched rather than `httpx.AsyncClient`, and that distinction is
    the whole reason the seam exists. `llm.httpx` is the same module object the test
    suite's own client is built from, so a fake installed there answers the requests to
    the app under test as well as the ones to the model — and does it silently, so the
    six tests it breaks all look like bugs in the feature.

    The slot is swapped rather than re-patched, for the reason `test_agent_runs` records:
    a helper that reads the real class at call time wraps the previous fake on a second
    application, and the first transport then answers everything.
    """
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    slot: dict[str, Any] = {"transport": anthropic_says("Sure.")}

    monkeypatch.setattr(llm, "open_client", lambda: httpx.AsyncClient(transport=slot["transport"]))
    return slot


async def collect(run_input: dict, persona: builtin.Persona) -> list[dict[str, Any]]:
    return [event async for event in builtin.stream(run_input, persona)]


def run_input(*messages: dict[str, Any], channel: str = "general") -> dict[str, Any]:
    return {
        "threadId": "t",
        "runId": "r",
        "messages": list(messages),
        "context": [{"description": "channel", "value": channel}],
    }


PERSONA = builtin.Persona(name="Blob", workspace_name="Acme")


class TestTheConversationHandedToTheModel:
    def test_the_speaker_survives_into_the_text(self) -> None:
        turns = builtin.turns_from(
            [
                {"role": "user", "content": "ship it?", "name": "Ada"},
                {"role": "assistant", "content": "not yet"},
            ]
        )
        # Merging consecutive same-role turns is what satisfies Anthropic's alternation
        # rule, and a merged turn has nowhere to put two names — so the name goes in the
        # text, where it survives the merge.
        assert turns[0].content == "Ada: ship it?"
        assert turns[1].content == "not yet"

    def test_a_channel_is_flattened_into_an_alternating_conversation(self) -> None:
        collapsed = llm._collapse(
            [
                llm.Turn(role="user", content="Ada: one"),
                llm.Turn(role="user", content="Bo: two"),
                llm.Turn(role="assistant", content="ok"),
            ]
        )
        # Three people can speak before the agent is mentioned. Anthropic rejects two
        # consecutive same-role messages outright, so this is not a nicety.
        assert [t["role"] for t in collapsed] == ["user", "assistant"]
        assert collapsed[0]["content"] == "Ada: one\n\nBo: two"

    def test_a_conversation_cannot_open_with_the_agent(self) -> None:
        collapsed = llm._collapse(
            [
                llm.Turn(role="assistant", content="hello"),
                llm.Turn(role="user", content="Ada: hi"),
            ]
        )
        # Happens when a bot posted first. A conversation starting with the model's own
        # words is not one it can answer.
        assert [t["role"] for t in collapsed] == ["user"]


class TestTheEventStream:
    async def test_an_answer_is_a_well_formed_agui_run(self, model: dict) -> None:
        events = await collect(run_input({"role": "user", "content": "hi", "name": "Ada"}), PERSONA)

        assert [e["type"] for e in events] == [
            "RUN_STARTED",
            "TEXT_MESSAGE_START",
            "TEXT_MESSAGE_CONTENT",
            "TEXT_MESSAGE_END",
            "RUN_FINISHED",
        ]
        # One message id throughout, which is what lets `Fold` seal it.
        ids = {e["messageId"] for e in events if "messageId" in e}
        assert len(ids) == 1

    async def test_a_refusal_becomes_run_error_not_an_exception(self, model: dict) -> None:
        model["transport"] = anthropic_says(status=400, body=b'{"error":{"message":"no credit"}}')

        events = await collect(run_input({"role": "user", "content": "hi"}), PERSONA)

        assert [e["type"] for e in events] == ["RUN_STARTED", "RUN_ERROR"]
        # The provider's own words are carried through. A bad model name or a key without
        # access says exactly what is wrong, and discarding it costs an afternoon.
        assert "no credit" in events[-1]["message"]

    async def test_nothing_is_started_before_the_first_token(self, model: dict) -> None:
        model["transport"] = anthropic_says(status=500)

        events = await collect(run_input({"role": "user", "content": "hi"}), PERSONA)

        # A model that fails immediately must not leave an empty message behind it.
        assert not any(e["type"] == "TEXT_MESSAGE_START" for e in events)

    async def test_a_silent_model_finishes_cleanly(self, model: dict) -> None:
        model["transport"] = anthropic_says()

        events = await collect(run_input({"role": "user", "content": "hi"}), PERSONA)

        # No reply is a legitimate outcome; `_run_one` posts nothing for it and the run
        # log calls it a success.
        assert [e["type"] for e in events] == ["RUN_STARTED", "RUN_FINISHED"]

    async def test_no_model_is_a_reason_rather_than_a_traceback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_PROVIDER", "disabled")

        events = await collect(run_input({"role": "user", "content": "hi"}), PERSONA)

        assert events[-1]["type"] == "RUN_ERROR"
        assert "no model is configured" in events[-1]["message"]


class TestWhatItIsTold:
    def test_it_is_told_it_has_no_tools(self) -> None:
        prompt = builtin.system_prompt(PERSONA, channel_name="general")

        # The first thing a chat model reaches for is claiming to have acted. It has no
        # tools, so every such claim is a lie told to a whole channel.
        assert "no tools" in prompt
        assert "#general" in prompt
        assert "Acme" in prompt

    def test_a_personal_agent_is_told_whose_it_is(self) -> None:
        mine = builtin.Persona(name="Ada's agent", workspace_name="Acme", owner_name="Ada")

        assert "Ada's own assistant" in builtin.system_prompt(mine, channel_name="general")


class TestItIsAPluginLikeAnyOther:
    async def test_a_manifest_cannot_claim_the_builtin_runtime(self, team: dict) -> None:  # noqa: F811
        response = await team["owner"].post(
            "/api/admin/plugins",
            {
                "slug": "impostor",
                "name": "Impostor",
                "runtime": "builtin",
                "scopes": ["messages:write"],
            },
        )

        # Not a scope question — no grant is involved. This runtime spends the *server's*
        # model key, so anyone who can register an app could spend it.
        assert response.status == 400, response.body
        assert response.body["error"]["code"] == "runtime_reserved"

    async def test_it_is_seeded_into_a_new_workspace(self, model: dict, client: Client) -> None:
        owner = await sign_up(client, "Founder")

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        agent = next(p for p in apps if p["slug"] == builtin.WORKSPACE_SLUG)
        assert agent["runtime"] == "builtin"
        assert agent["status"] == "enabled"

    async def test_it_is_in_the_public_channels_already(self, model: dict, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        channels = (await owner.get("/api/channels")).body["channels"]

        member_ids = (await owner.get(f"/api/channels/{channels[0]['id']}/members")).body["userIds"]
        people = (await owner.get("/api/users")).body["users"]
        agent = next(u for u in people if u["displayName"] == workspace_agent.AGENT_NAME)
        # An agent nobody remembered to add is an agent nobody uses. It only speaks when
        # mentioned, so being present costs a line in the member list and nothing else.
        assert agent["id"] in member_ids

    async def test_nothing_is_seeded_without_a_model(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_PROVIDER", "disabled")
        owner = await sign_up(client, "Founder")

        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        # An agent that can only apologise is worse than an absent one.
        assert not any(p["slug"] == builtin.WORKSPACE_SLUG for p in apps)

    async def test_seeding_twice_installs_once(self, model: dict, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        workspace_id = await workspace_id_of(owner)

        seeded = await workspace_agent.ensure_everywhere()

        # It runs at every boot; the second one has to be a no-op, or a restart would
        # mint a second bot and the display-name allocator would suffix it "Blob 2".
        assert seeded == 0
        async with SessionFactory() as session:
            count = (
                await session.execute(
                    text(
                        "SELECT count(*)::int AS n FROM plugins "
                        "WHERE workspace_id = :ws AND runtime = 'builtin'"
                    ),
                    {"ws": workspace_id},
                )
            ).scalar_one()
        assert count == 1


class TestAnsweringInAChannel:
    async def test_it_answers_when_mentioned(self, model: dict, client: Client) -> None:
        model["transport"] = anthropic_says("On it.")
        owner = await sign_up(client, "Founder")
        channel = (await owner.get("/api/channels")).body["channels"][0]["id"]

        sent = await send_message(owner, channel, f"@{workspace_agent.AGENT_NAME} what's up?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        history = (await owner.get(f"/api/channels/{channel}/messages")).body["messages"]
        assert any(m["body"] == "On it." for m in history)

    async def test_the_run_is_logged_as_running_here(self, model: dict, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        channel = (await owner.get("/api/channels")).body["channels"][0]["id"]
        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        plugin_id = next(p["id"] for p in apps if p["slug"] == builtin.WORKSPACE_SLUG)

        sent = await send_message(owner, channel, f"@{workspace_agent.AGENT_NAME} hi")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        runs = (await owner.get(f"/api/admin/plugins/{plugin_id}/runs")).body["runs"]
        assert len(runs) == 1
        # Recorded as "builtin" rather than "http": a run that never crossed a network
        # should not be logged as if it had.
        assert runs[0]["transport"] == "builtin"
        assert runs[0]["status"] == "succeeded"

    async def test_a_disabled_agent_stops_answering(self, model: dict, client: Client) -> None:
        owner = await sign_up(client, "Founder")
        channel = (await owner.get("/api/channels")).body["channels"][0]["id"]
        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        plugin_id = next(p["id"] for p in apps if p["slug"] == builtin.WORKSPACE_SLUG)
        assert (
            await owner.post(f"/api/admin/plugins/{plugin_id}/enabled", {"enabled": False})
        ).status == 200

        sent = await send_message(owner, channel, f"@{workspace_agent.AGENT_NAME} hi")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        runs = (await owner.get(f"/api/admin/plugins/{plugin_id}/runs")).body["runs"]
        # The whole point of it being a plugin: an admin can turn it off, and turning it
        # off means it does not run at all rather than runs and stays quiet.
        assert runs == []
