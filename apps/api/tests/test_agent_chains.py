"""Agents answering each other, inside a chain a person rooted.

The old rule was that only a person's message started a run — the loop guard, structural
and total. These pin its replacement (ADR 0013): an agent's reply that mentions another
agent extends the chain by a hop, *on the person's authority*, inside a depth budget,
with a per-agent cap that ends ping-pong and a Stop that takes the whole chain down.

The rule a reader should take away: a hop is allowed exactly when the person at the root
could have asked that agent themselves, and refused silently when they could not.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import builtin, streams
from blob_api.services import agent_chains

from .helpers import (
    Client,
    allow_policy,
    invite_and_sign_up,
    send_message,
    sign_up,
    workspace_id_of,
)
from .test_agui import (
    ANSWER,
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
    install,
    join_channel,
    messages_in,
)

PLANNER = {
    "slug": "planner",
    "name": "Planner",
    "aguiUrl": "https://apps.example.com/planner",
}

HELPER_ASKS_PLANNER = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(type="TEXT_MESSAGE_START", messageId="m1"),
    frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="@Planner can you outline this?"),
    frame(type="TEXT_MESSAGE_END", messageId="m1"),
    frame(type="RUN_FINISHED", threadId="t", runId="r"),
)

PLANNER_ASKS_HELPER = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(type="TEXT_MESSAGE_START", messageId="m1"),
    frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="@Helper what did they mean?"),
    frame(type="TEXT_MESSAGE_END", messageId="m1"),
    frame(type="RUN_FINISHED", threadId="t", runId="r"),
)

HELPER_MENTIONS_ITSELF = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(type="TEXT_MESSAGE_START", messageId="m1"),
    frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="@Helper note to self."),
    frame(type="TEXT_MESSAGE_END", messageId="m1"),
    frame(type="RUN_FINISHED", threadId="t", runId="r"),
)


async def _nothing() -> None:
    """What a recorded `enqueue` hands to `fire_and_forget`: a coroutine that does nothing."""


def two_agents(
    scripts: dict[str, tuple[bytes, ...]],
) -> tuple[httpx.MockTransport, dict[str, list[httpx.Request]]]:
    """Two fake agents behind one transport, told apart by path."""
    seen: dict[str, list[httpx.Request]] = {path: [] for path in scripts}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        seen.setdefault(path, []).append(request)
        return httpx.Response(
            200,
            content=b"".join(scripts.get(path, ANSWER)),
            headers={"content-type": "text/event-stream"},
        )

    return httpx.MockTransport(handler), seen


@pytest_asyncio.fixture
async def room(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict:
    """Helper and Planner in #general, with a swappable pair of scripts."""
    owner = await sign_up(client, "Owner")
    marko = await invite_and_sign_up(owner, "Marko")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    helper = await install(owner)
    planner = await install(owner, **PLANNER)
    await join_channel(owner, helper, general)
    await join_channel(owner, planner, general)

    slot: dict[str, Any] = {"transport": None}
    real = httpx.AsyncClient

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        # `streams.httpx` is the `httpx` module itself, so this fake also answers the
        # test client's own `fork()`. Until an agent transport is set, hand back what the
        # caller asked for; a fork made before the first run must still reach the app.
        theirs = kwargs.pop("transport", None)
        return real(**kwargs, transport=slot["transport"] or theirs)

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)

    enqueued: list[tuple[Any, ...]] = []

    def record(job: str, *args: Any) -> Any:
        # Appended when `enqueue(...)` is *called*, not when the fire-and-forget task
        # runs — the test reads the list straight after the request returns.
        enqueued.append((job, *args))
        return _nothing()

    from blob_api.lib import queue as queue_module

    monkeypatch.setattr(agui_job, "enqueue", record)
    monkeypatch.setattr(queue_module, "enqueue", record)

    return {
        "owner": owner,
        "marko": marko,
        "general": general,
        "helper": helper,
        "planner": planner,
        "slot": slot,
        "enqueued": enqueued,
        "workspace_id": await workspace_id_of(owner),
    }


def speak(room: dict, **scripts: tuple[bytes, ...]) -> dict[str, list[httpx.Request]]:
    transport, seen = two_agents(
        {"/agui": scripts.get("helper", ANSWER), "/planner": scripts.get("planner", ANSWER)}
    )
    room["slot"]["transport"] = transport
    return seen


async def root_run(room: dict, asker: Client, body: str = "@Helper sort this out") -> str:
    sent = await send_message(asker, room["general"], body)
    message_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(message_id)
    return message_id


def spawned(room: dict) -> list[tuple[str, str]]:
    """(message id, parent run id) for every hop the job asked for."""
    return [
        (args[1], args[2]) for args in room["enqueued"] if args[0] == "agui_run" and len(args) == 3
    ]


async def follow_hops(room: dict, *, rounds: int = 6) -> None:
    """Drive every enqueued hop, as the worker would, until nothing new is enqueued."""
    done: set[tuple[str, str]] = set()
    for _ in range(rounds):
        pending = [hop for hop in spawned(room) if hop not in done]
        if not pending:
            return
        for message_id, parent_run_id in pending:
            done.add((message_id, parent_run_id))
            await agui_job.handle_agui_run(message_id, parent_run_id)


async def runs(room: dict) -> list[dict]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT r.id, p.slug, r.depth, r.chain_id, r.parent_run_id,
                           r.initiated_by_user_id, r.status, r.cancel_requested_at
                      FROM agent_runs r JOIN plugins p ON p.id = r.plugin_id
                     WHERE r.workspace_id = :ws ORDER BY r.started_at
                    """
                ),
                {"ws": room["workspace_id"]},
            )
        ).fetchall()
    return [dict(row._mapping) for row in rows]


async def set_depth(room: dict, depth: int) -> None:
    await allow_policy(room["workspace_id"])
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                text(
                    """
                    UPDATE workspace_policies SET agent_chain_max_depth = :d
                     WHERE workspace_id = :ws
                    """
                ),
                {"d": depth, "ws": room["workspace_id"]},
            )


class TestAHop:
    async def test_an_agents_reply_that_mentions_another_agent_starts_a_child_run(
        self, room: dict
    ) -> None:
        seen = speak(room, helper=HELPER_ASKS_PLANNER)
        root_id = await root_run(room, room["owner"])

        # The reply mentioned Planner, so the job asked for a hop with itself as parent.
        [(hop_message, parent_run)] = spawned(room)
        await agui_job.handle_agui_run(hop_message, parent_run)

        assert len(seen["/planner"]) == 1
        planner_input = json.loads(seen["/planner"][0].content)
        context = {c["description"]: c["value"] for c in planner_input["context"]}
        assert context["asked_by"] == "Helper"
        assert context["asked_by_agent"] == "Helper"
        assert context["on_behalf_of"] == "Owner"
        assert "Helper" in context["participants"]

        by_slug = {run["slug"]: run for run in await runs(room)}
        assert by_slug["helper"]["depth"] == 0
        assert by_slug["planner"]["depth"] == 1
        assert str(by_slug["planner"]["chain_id"]) == root_id
        assert str(by_slug["planner"]["parent_run_id"]) == str(by_slug["helper"]["id"])
        assert str(by_slug["planner"]["initiated_by_user_id"]) == room["owner"].user_id
        assert "Standup is at nine." in [m["body"] for m in await messages_in(room["general"])]

    async def test_a_bot_api_post_never_starts_a_run(self, room: dict) -> None:
        # A bot's message with no parent run is how the bot API posts, and it stays
        # inert: there is no person behind it to run on the authority of.
        app_client = await join_channel(room["owner"], room["helper"], room["general"])
        seen = speak(room)
        posted = await app_client.post(
            "/api/v1/chat.postMessage", {"channel": room["general"], "text": "@Planner hello"}
        )

        await agui_job.handle_agui_run(posted.body["message"]["id"])

        assert seen["/planner"] == []
        assert spawned(room) == []

    async def test_an_agent_mentioning_itself_does_not_run_again(self, room: dict) -> None:
        seen = speak(room, helper=HELPER_MENTIONS_ITSELF)
        await root_run(room, room["owner"])
        await follow_hops(room)

        assert len(seen["/agui"]) == 1


class TestWhoseAuthority:
    async def give_planner_to(self, room: dict, person: Client) -> None:
        answer = await room["owner"].put(
            f"/api/admin/plugins/{room['planner']['plugin']['id']}/owner",
            {"userId": person.user_id},
        )
        assert answer.status == 200, answer.body

    async def test_a_hop_carries_the_persons_authority_not_the_agents(self, room: dict) -> None:
        # Planner is Marko's. Owner asks Helper; Helper asks Planner. Helper is everybody's
        # agent, but Owner could not command Planner directly, so Helper cannot on Owner's
        # behalf either — otherwise the workspace agent is a proxy into anyone's agent.
        await self.give_planner_to(room, room["marko"])
        seen = speak(room, helper=HELPER_ASKS_PLANNER)
        await root_run(room, room["owner"])
        await follow_hops(room)

        assert seen["/planner"] == []
        # Refused silently: no run row, no card, nothing said.
        assert [run["slug"] for run in await runs(room)] == ["helper"]

    async def test_and_runs_when_the_person_could_have_asked_it_themselves(
        self, room: dict
    ) -> None:
        await self.give_planner_to(room, room["marko"])
        seen = speak(room, helper=HELPER_ASKS_PLANNER)
        await root_run(room, room["marko"])
        await follow_hops(room)

        assert len(seen["/planner"]) == 1


class TestTheBudget:
    async def test_the_depth_budget_ends_a_chain_silently(self, room: dict) -> None:
        # Depth 1: Helper→Planner is allowed, Planner→Helper is not.
        await set_depth(room, 1)
        seen = speak(room, helper=HELPER_ASKS_PLANNER, planner=PLANNER_ASKS_HELPER)
        await root_run(room, room["owner"])
        await follow_hops(room)

        assert len(seen["/planner"]) == 1
        assert len(seen["/agui"]) == 1
        assert [run["depth"] for run in await runs(room)] == [0, 1]

    async def test_depth_zero_is_yesterdays_behaviour(self, room: dict) -> None:
        await set_depth(room, 0)
        seen = speak(room, helper=HELPER_ASKS_PLANNER)
        await root_run(room, room["owner"])
        await follow_hops(room)

        assert seen["/planner"] == []
        # Not even asked for: with no room to grow, the reply is not handed to the job.
        assert spawned(room) == []

    async def test_the_environment_is_the_ceiling(
        self, room: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        await set_depth(room, 4)
        monkeypatch.setattr(settings, "AGENT_CHAIN_MAX_DEPTH", 0)
        seen = speak(room, helper=HELPER_ASKS_PLANNER)
        await root_run(room, room["owner"])
        await follow_hops(room)

        assert seen["/planner"] == []

    async def test_ping_pong_stops_at_the_per_agent_cap(self, room: dict) -> None:
        # Depth 16 would allow sixteen hops; the per-agent cap ends A→B→A→B first.
        await set_depth(room, 16)
        seen = speak(room, helper=HELPER_ASKS_PLANNER, planner=PLANNER_ASKS_HELPER)
        await root_run(room, room["owner"])
        await follow_hops(room, rounds=20)

        assert len(seen["/agui"]) <= agent_chains.MAX_RUNS_PER_AGENT_PER_CHAIN
        assert len(seen["/planner"]) <= agent_chains.MAX_RUNS_PER_AGENT_PER_CHAIN
        assert len(await runs(room)) <= agent_chains.MAX_RUNS_PER_CHAIN
        # And it did converse: more than the single hop the old rule could never allow.
        assert len(seen["/agui"]) + len(seen["/planner"]) >= 3

    async def test_a_stale_chain_admits_nothing(self, room: dict) -> None:
        speak(room, helper=HELPER_ASKS_PLANNER)
        await root_run(room, room["owner"])
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE agent_runs SET started_at = now() - make_interval(secs => :s)"),
                    {"s": agent_chains.CHAIN_MAX_SEC + 60},
                )
        seen = speak(room, helper=HELPER_ASKS_PLANNER)
        await follow_hops(room)

        assert seen["/planner"] == []


class TestStop:
    async def test_cancelling_a_parent_cancels_its_running_children(self, room: dict) -> None:
        speak(room, helper=HELPER_ASKS_PLANNER)
        await root_run(room, room["owner"])
        await follow_hops(room)
        by_slug = {run["slug"]: run for run in await runs(room)}
        # Put both back to running, as they would be mid-flight.
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE agent_runs SET status = 'running', finished_at = NULL")
                )

        stopped = await room["owner"].post(f"/api/agent-runs/{by_slug['helper']['id']}/cancel", {})

        assert stopped.status == 200, stopped.body
        after = {run["slug"]: run for run in await runs(room)}
        assert after["planner"]["cancel_requested_at"] is not None

    async def test_a_hop_enqueued_after_its_parent_was_stopped_never_starts(
        self, room: dict
    ) -> None:
        speak(room, helper=HELPER_ASKS_PLANNER)
        await root_run(room, room["owner"])
        [(hop_message, parent_run)] = spawned(room)
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE agent_runs SET cancel_requested_at = now() WHERE id = :id"),
                    {"id": parent_run},
                )
        seen = speak(room, helper=HELPER_ASKS_PLANNER)

        await agui_job.handle_agui_run(hop_message, parent_run)

        assert seen["/planner"] == []


class TestTheBuiltinKnowsTheRoom:
    def test_it_is_told_who_else_is_in_the_room(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Imba")
        prompt = builtin.system_prompt(persona, channel_name="general", participants=["Planner"])
        assert "Planner" in prompt
        assert "@Name" in prompt

    def test_and_says_nothing_about_agents_when_it_is_alone(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Imba")
        prompt = builtin.system_prompt(persona, channel_name="general")
        assert "Other agents" not in prompt

    def test_being_asked_by_an_agent_is_described_as_such(self) -> None:
        persona = builtin.Persona(name="Blob", workspace_name="Imba")
        prompt = builtin.system_prompt(
            persona, channel_name="general", asked_by_agent="Janus", on_behalf_of="Marko"
        )
        assert "mentioned by Janus" in prompt
        assert "on behalf of Marko" in prompt


class TestThePolicyRoundTrips:
    async def test_through_the_console_route(self, client: Client) -> None:
        owner = await sign_up(client, "Owner")
        workspace_id = await workspace_id_of(owner)

        written = await owner.put(
            f"/api/admin/instance/workspaces/{workspace_id}/policy", {"agentChainMaxDepth": 2}
        )
        assert written.status == 200, written.body
        assert written.body["agentChainMaxDepth"] == 2
        assert written.body["serverChainMaxDepth"] == settings.AGENT_CHAIN_MAX_DEPTH

        read = await owner.get(f"/api/admin/instance/workspaces/{workspace_id}/policy")
        assert read.body["agentChainMaxDepth"] == 2


class TestAnAgentOnASchedule:
    async def test_a_scheduled_message_that_mentions_an_agent_roots_a_chain(
        self, room: dict
    ) -> None:
        """Proactive agents need no new machinery: a scheduled message is sent through the
        ordinary send path, so one that mentions an agent starts a run when it sends — on
        the author's authority, exactly as if they had typed it then. This pins that the
        path stays wired; the guide now says so out loud."""
        from datetime import UTC, datetime, timedelta

        from blob_api.jobs.scheduled import send_scheduled

        seen = speak(room)
        when = (datetime.now(UTC) + timedelta(hours=1)).isoformat().replace("+00:00", "Z")
        scheduled = await room["owner"].post(
            f"/api/channels/{room['general']}/schedule",
            {"body": "@Helper morning report, please", "sendAt": when, "clientMsgId": "sched-1"},
        )
        assert scheduled.status in (200, 201), scheduled.body
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE scheduled_messages SET send_at = now() - interval '1 minute'")
                )

        await send_scheduled({})

        # The send announced itself, which asked for a root run of the new message.
        roots = [args for args in room["enqueued"] if args[0] == "agui_run" and len(args) == 2]
        assert len(roots) == 1
        await agui_job.handle_agui_run(roots[0][1])

        assert len(seen["/agui"]) == 1
        context = {
            c["description"]: c["value"] for c in json.loads(seen["/agui"][0].content)["context"]
        }
        assert context["asked_by"] == "Owner"
        [run] = await runs(room)
        assert run["depth"] == 0
        assert str(run["initiated_by_user_id"]) == room["owner"].user_id
