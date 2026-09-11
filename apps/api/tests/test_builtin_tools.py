"""The built-in agent can read the workspace — as the person who asked, and no further.

Until now @Blob could only talk from the thread it was mentioned in, and its own system
prompt said so. These pin what changes: asked "what did I miss in #ops" from #general,
it reads #ops through the same tool the MCP server offers an assistant, running as the
asker (ADR 0013 — a hop carries the root person's authority, never the agent's), and
answers from what it read. Asked about a private channel the asker is not in, the tool
answers the way the channel does — not found — and nothing from that channel reaches the
model. A revoked grant removes the tool from what the model is offered at all, rather
than leaving it to fail.

The provider is scripted: first request asks for `read_channel`, second answers. What
the second request carries is the assertion that matters, because it is the only place
the boundary between "the agent read a channel" and "the channel instructed the agent"
can be seen.
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
from blob_api.services import mcp, workspace_agent

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_llm_tools_anthropic import streamed, text_events, tool_use_events


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """A configured Anthropic that asks for one tool, then answers with `reply`.

    `seen` collects every request body the model received, in order."""
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    monkeypatch.setattr(settings, "LLM_BASE_URL", None)
    slot: dict[str, Any] = {
        "tool": ("read_channel", {"channel": "#ops"}),
        "reply": "ok",
        "seen": [],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        slot["seen"].append(body)
        if len(slot["seen"]) == 1 and slot["tool"] is not None:
            name, arguments = slot["tool"]
            return streamed(*tool_use_events("toolu_1", name, arguments))
        return streamed(*text_events(slot["reply"]))

    monkeypatch.setattr(
        llm, "open_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    return slot


async def _general(client: Client) -> str:
    return str((await client.get("/api/channels")).body["channels"][0]["id"])


async def _ask(client: Client, channel_id: str, question: str) -> None:
    sent = await send_message(client, channel_id, f"@{workspace_agent.AGENT_NAME} {question}")
    await agui_job.handle_agui_run(sent.body["message"]["id"])


async def _bodies(client: Client, channel_id: str) -> list[str]:
    history = (await client.get(f"/api/channels/{channel_id}/messages")).body["messages"]
    return [str(m["body"]) for m in history]


def _tool_names(request: dict[str, Any]) -> list[str]:
    return [str(tool["name"]) for tool in request.get("tools") or []]


def _tool_results(request: dict[str, Any]) -> str:
    """Every tool_result block in a request, as one string to search."""
    parts: list[str] = []
    for message in request.get("messages") or []:
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                parts.append(str(block.get("content")))
    return "\n".join(parts)


class TestReadingAsTheAsker:
    async def test_it_reads_the_channel_it_was_asked_about(
        self, model: dict[str, Any], client: Client
    ) -> None:
        model["reply"] = "Deploy finished, all green."
        owner = await sign_up(client, "Founder")
        ops = (await owner.post("/api/channels", {"name": "ops", "kind": "public"})).body[
            "channel"
        ]["id"]
        await send_message(owner, ops, "deploy finished, all green")

        general = await _general(owner)
        await _ask(owner, general, "what did I miss in #ops")

        first, second = model["seen"]
        assert "read_channel" in _tool_names(first)
        assert "deploy finished, all green" in _tool_results(second)
        assert "Deploy finished, all green." in await _bodies(owner, general)

    async def test_a_private_channel_the_asker_is_not_in_stays_private(
        self, model: dict[str, Any], client: Client
    ) -> None:
        model["tool"] = ("read_channel", {"channel": "#secret"})
        model["reply"] = "I can't see that channel."
        owner = await sign_up(client, "Founder")
        marko = await invite_and_sign_up(owner, "Marko")
        secret = (await owner.post("/api/channels", {"name": "secret", "kind": "private"})).body[
            "channel"
        ]["id"]
        await send_message(owner, secret, "the secret plan is to buy the competitor")

        general = await _general(marko)
        await _ask(marko, general, "what is in #secret")

        second = model["seen"][1]
        assert "secret plan" not in json.dumps(second)
        assert _tool_results(second)  # the refusal went back as the tool's answer
        assert "I can't see that channel." in await _bodies(marko, general)

    async def test_the_tool_calls_are_on_the_run_card(
        self, model: dict[str, Any], client: Client
    ) -> None:
        owner = await sign_up(client, "Founder")
        ops = (await owner.post("/api/channels", {"name": "ops", "kind": "public"})).body[
            "channel"
        ]["id"]
        await send_message(owner, ops, "shipped")
        general = await _general(owner)
        await _ask(owner, general, "what happened in #ops")

        # The endpoint the client folds in on load, so the card a person sees is the one
        # asserted here rather than a shape only the console reads.
        runs = (await owner.get(f"/api/channels/{general}/agent-runs")).body["runs"]
        card = runs[0]["card"]
        assert card is not None
        assert [tool["name"] for tool in card["tools"]] == ["read_channel"]
        assert card["tools"][0]["status"] == "done"
        assert "shipped" in (card["tools"][0]["result"] or "")


class TestWhatItIsOffered:
    def test_tools_follow_the_plugins_grants(self) -> None:
        held = {t["name"] for t in mcp.tools_for_agent(frozenset({"messages:read"}))}
        assert held == {"whoami", "read_channel", "read_thread", "search_messages"}

        with_people = {t["name"] for t in mcp.tools_for_agent(frozenset({"users:read"}))}
        assert with_people == {"whoami", "list_people"}

        # Write tools are not offered here whatever the grants say; that is a later slice.
        everything = frozenset({"messages:read", "messages:write", "channels:read", "users:read"})
        assert "post_message" not in {t["name"] for t in mcp.tools_for_agent(everything)}

    def test_the_shape_is_what_the_model_layer_takes(self) -> None:
        (tool,) = [t for t in mcp.tools_for_agent(frozenset()) if t["name"] == "whoami"]
        assert set(tool) == {"name", "description", "input_schema"}

    async def test_the_seeded_agent_may_see_who_is_here(
        self, model: dict[str, Any], client: Client
    ) -> None:
        """Naming a person is not a bonus feature, it is most of what gets asked.

        "Who should I ask about billing", "is Ana around", "who owns this channel" — and
        the hand-off rule the prompt teaches, write @Name to pass work to another agent,
        needs the names to be real. The agent shipped able to read every channel the
        asker can and unable to say who was in them, because `users:read` was not among
        the scopes it is seeded with.
        """
        model["tool"] = None
        owner = await sign_up(client, "Founder")
        await _ask(owner, await _general(owner), "who is in this workspace")

        assert "list_people" in _tool_names(model["seen"][0])

    async def test_a_revoked_grant_removes_the_tool(
        self, model: dict[str, Any], client: Client
    ) -> None:
        model["tool"] = None  # the model is offered nothing to call, so it just answers
        owner = await sign_up(client, "Founder")
        apps = (await owner.get("/api/admin/plugins")).body["plugins"]
        plugin_id = next(p["id"] for p in apps if p["slug"] == builtin.WORKSPACE_SLUG)
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("DELETE FROM plugin_grants WHERE plugin_id = :id AND scope = 'messages:read'"),
                {"id": plugin_id},
            )

        await _ask(owner, await _general(owner), "what did I miss in #ops")

        offered = _tool_names(model["seen"][0])
        assert "read_channel" not in offered
        assert "list_channels" in offered  # channels:read is still held


class TestInADirectMessage:
    async def test_a_personal_agent_is_handed_the_same_tools(
        self, model: dict[str, Any], client: Client
    ) -> None:
        """The DM is the room where "what did I miss" is actually typed.

        Its prompt now tells it it can go and look on the owner's behalf, so the run has
        to hand it the tools that make that true. A prompt promising a capability the run
        withholds is the exact failure the "You have no tools" line existed to prevent,
        moved one room over.
        """
        model["tool"] = None
        owner = await sign_up(client, "Founder")
        bot = next(
            person["id"]
            for person in (await owner.get("/api/users")).body["users"]
            if person["displayName"] == workspace_agent.AGENT_NAME
        )
        dm = (await owner.post("/api/dms", {"userIds": [bot]})).body["channel"]["id"]

        sent = await send_message(owner, dm, "what did I miss?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        offered = _tool_names(model["seen"][0])
        assert "read_channel" in offered
        assert "list_people" in offered


class TestWhatItIsTold:
    def test_the_prompt_says_what_it_can_read_when_it_has_tools(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Acme")
        tools = mcp.tools_for_agent(frozenset({"messages:read", "channels:read"}))

        with_tools = builtin.system_prompt(persona, channel_name="general", tools=tools)
        assert "You have no tools" not in with_tools
        assert "read" in with_tools.lower()
        assert "as the person who asked" in with_tools

        without = builtin.system_prompt(persona, channel_name="general")
        assert "You have no tools" in without

    def test_a_personal_agent_with_tools_no_longer_claims_blindness(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Acme", owner_name="Marko")
        tools = mcp.tools_for_agent(frozenset({"messages:read"}))

        prompt = builtin.system_prompt(persona, channel_name="dm", tools=tools)
        assert "cannot read Marko's channels" not in prompt
        assert "You can see only this conversation" not in prompt
