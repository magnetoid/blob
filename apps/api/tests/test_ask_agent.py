"""One agent asking another, and hearing the answer (M1 · A2).

A reply that mentions an agent already started a hop (ADR 0013); `ask_agent` lets the
asking agent *hear* the answer. These pin that it is the same hop — the question posted
in the room as the asking agent, admitted by the chain's rules, on the root person's
authority — and that every way it can end comes back to the asking agent as something it
can act on: the answer, a question the other agent asked, a refusal with the reason, or
"still working".
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.jobs import agui_delegate
from blob_api.plugins import streams
from blob_api.services import mcp as mcp_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of
from .test_agent_chains import PLANNER, set_depth
from .test_agent_tools import calls, says
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    install,
    join_channel,
)
from .test_files_and_tasks_tools import agent_caller
from .test_mcp import Mcp, mint
from .test_task_dispatch import STOPS_TO_ASK

SCRIBE = {"slug": "scribe", "name": "Scribe", "aguiUrl": "https://apps.example.com/scribe"}


@pytest_asyncio.fixture
async def pair(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Helper (with read access to Blob's tools) and Planner in #general; Scribe installed
    but in no channel. Every queued agent run really runs, so a hop happens while the
    asking run waits for it."""
    owner = await sign_up(client, "Owner")
    marko = await invite_and_sign_up(owner, "Marko")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    helper = await install(owner)
    planner = await install(owner, **PLANNER)
    scribe = await install(owner, **SCRIBE)
    await join_channel(owner, helper, general)
    await join_channel(owner, planner, general)
    granted = await owner.post(
        f"/api/admin/plugins/{helper['plugin']['id']}/tools", {"access": "read"}
    )
    assert granted.status == 200, granted.body

    state: dict[str, Any] = {"scripts": {}, "seen": {}, "slow": set(), "tasks": []}
    real = httpx.AsyncClient

    async def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        state["seen"].setdefault(path, []).append(request)
        if path in state["slow"]:
            await asyncio.sleep(2.5)
        queue = state["scripts"].get(path) or []
        body = queue.pop(0) if queue else says("(nothing more to say)")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        if isinstance(kwargs.get("transport"), httpx.ASGITransport):
            return real(**kwargs)
        kwargs.pop("transport", None)
        return real(**kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)

    async def nothing() -> None:
        return None

    def run_for_real(job: str, *args: Any) -> Any:
        if job == "agui_run":
            state["tasks"].append(asyncio.create_task(agui_job.handle_agui_run(*args)))
        return nothing()

    from blob_api.lib import queue as queue_module
    from blob_api.services import agent_chains

    monkeypatch.setattr(queue_module, "enqueue", run_for_real)
    monkeypatch.setattr(agent_chains, "enqueue", run_for_real)
    # The tests are about what happens, not about how long the real limits are.
    monkeypatch.setattr(agui_delegate, "POLL_SEC", 0.05)
    monkeypatch.setattr(agui_delegate, "NO_RUN_GRACE_SEC", 3.0)

    return {
        "owner": owner,
        "marko": marko,
        "general": general,
        "helper": helper,
        "planner": planner,
        "scribe": scribe,
        "state": state,
        "workspace_id": await workspace_id_of(owner),
    }


async def settle(pair: dict[str, Any]) -> None:
    """Every run the conversation set going, finished — including hops started on the way."""
    tasks: list[asyncio.Task[Any]] = pair["state"]["tasks"]
    for _ in range(600):
        await asyncio.sleep(0.05)
        if tasks and all(task.done() for task in tasks):
            await asyncio.sleep(0.2)
            if all(task.done() for task in tasks):
                break
    for task in tasks:
        task.result()


async def ask_helper(pair: dict[str, Any], body: str, **scripts: list[bytes]) -> None:
    pair["state"]["scripts"] = {f"/{path}": list(queue) for path, queue in scripts.items()}
    sent = await send_message(pair["owner"], pair["general"], body)
    assert sent.status == 201, sent.body
    await settle(pair)


def tool_results(pair: dict[str, Any]) -> list[str]:
    """What Helper was handed back, round by round."""
    out = []
    for request in pair["state"]["seen"].get("/agui", []):
        for message in json.loads(request.content)["messages"]:
            if message.get("role") == "tool":
                out.append(str(message["content"]))
    return out


async def bodies(pair: dict[str, Any]) -> list[tuple[str, str]]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT u.display_name, m.body FROM messages m
                      JOIN users u ON u.id = m.author_id
                     WHERE m.channel_id = :c ORDER BY m.id
                    """
                ),
                {"c": pair["general"]},
            )
        ).fetchall()
    return [(row.display_name, row.body) for row in rows]


class TestAskingAndHearingBack:
    async def test_the_answer_comes_back_as_the_calls_result(self, pair: dict[str, Any]) -> None:
        await ask_helper(
            pair,
            "@Helper plan the launch",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Planner", "text": "outline the launch"})),
                says("Planner suggests: scope, then ship."),
            ],
            planner=[says("1. Scope 2. Ship")],
        )
        results = tool_results(pair)
        assert results and results[-1].startswith("Planner answered:")
        assert "1. Scope 2. Ship" in results[-1]

        # The room saw all of it: the question as Helper, Planner's answer, Helper's.
        said = await bodies(pair)
        assert ("Helper", "@Planner outline the launch") in said
        assert ("Planner", "1. Scope 2. Ship") in said
        assert ("Helper", "Planner suggests: scope, then ship.") in said

    async def test_it_is_a_hop_of_the_same_chain_on_the_persons_authority(
        self, pair: dict[str, Any]
    ) -> None:
        await ask_helper(
            pair,
            "@Helper plan the launch",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Planner", "text": "outline it"})),
                says("Done."),
            ],
            planner=[says("Outline.")],
        )
        async with SessionFactory() as session:
            runs = {
                row.name: row
                for row in (
                    await session.execute(
                        text(
                            """
                            SELECT p.name, r.id, r.parent_run_id, r.chain_id, r.depth,
                                   r.initiated_by_user_id, r.status
                              FROM agent_runs r JOIN plugins p ON p.id = r.plugin_id
                            """
                        )
                    )
                ).fetchall()
            }
        helper, planner = runs["Helper"], runs["Planner"]
        assert planner.parent_run_id == helper.id
        assert planner.chain_id == helper.chain_id
        assert planner.depth == 1
        assert str(planner.initiated_by_user_id) == pair["owner"].user_id
        assert (helper.status, planner.status) == ("succeeded", "succeeded")

        # And the asking run's answer is what it said, not the question it asked.
        from blob_api.services import agent_runs

        async with SessionFactory() as session:
            assert await agent_runs.answer_of(session, str(helper.id)) == ["Done."]

        # Planner was told who asked, as any hop is.
        planner_input = json.loads(pair["state"]["seen"]["/planner"][0].content)
        context = {item["description"]: item["value"] for item in planner_input["context"]}
        assert context["asked_by_agent"] == "Helper"

    async def test_a_hop_that_stops_to_ask_the_person_is_said_so(
        self, pair: dict[str, Any]
    ) -> None:
        await ask_helper(
            pair,
            "@Helper write the notes",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Planner", "text": "draft them"})),
                says("Planner needs an answer from you first."),
            ],
            planner=[STOPS_TO_ASK],
        )
        assert (
            "stopped to ask the person this runs for: Include the risks?" in tool_results(pair)[-1]
        )

    async def test_a_slow_hop_is_still_working_and_answers_the_room_later(
        self, pair: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(agui_delegate, "ASK_WAIT_SEC", 0.5)
        pair["state"]["slow"].add("/planner")
        await ask_helper(
            pair,
            "@Helper plan it",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Planner", "text": "outline it"})),
                says("Planner is on it."),
            ],
            planner=[says("Here is the outline.")],
        )
        assert tool_results(pair)[-1].startswith("Planner is still working on it.")
        # It did answer — in the room, where everyone reads it.
        assert ("Planner", "Here is the outline.") in await bodies(pair)


class TestTheWorkerStaysUp:
    def test_waiting_runs_never_take_more_than_half_the_workers_slots(self) -> None:
        """A waiting run holds a slot, and so does the hop it waits for: if waiters could
        fill every slot, the hops would never start and nothing else would either."""
        from blob_api.jobs.worker import WorkerSettings

        assert 1 <= agui_delegate.MAX_WAITERS <= WorkerSettings.max_jobs // 2

    async def test_past_the_cap_the_question_is_asked_and_not_waited_for(
        self, pair: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(agui_delegate, "MAX_WAITERS", 0)
        await ask_helper(
            pair,
            "@Helper plan the launch",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Planner", "text": "outline it"})),
                says("Planner will answer below."),
            ],
            planner=[says("Here is the outline.")],
        )
        assert "cannot wait for it right now" in tool_results(pair)[-1]
        said = await bodies(pair)
        # Asked, and answered, in the room — only the asking run did not wait.
        assert ("Helper", "@Planner outline it") in said
        assert ("Planner", "Here is the outline.") in said
        assert agui_delegate._waiting == 0, "the count of waiting runs went back down"


class TestWhatItWillNotDo:
    async def test_an_agent_not_in_this_conversation_is_refused_and_nothing_is_posted(
        self, pair: dict[str, Any]
    ) -> None:
        await ask_helper(
            pair,
            "@Helper ask Scribe",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Scribe", "text": "take notes"})),
                says("Scribe is not here."),
            ],
        )
        assert "Scribe isn't in this channel" in tool_results(pair)[-1]
        assert not any("@Scribe" in body for _, body in await bodies(pair))

    async def test_an_agent_the_person_may_not_command_is_refused(
        self, pair: dict[str, Any]
    ) -> None:
        """The authority is the person's at the root: an agent only Marko may command is
        not reachable through Helper because the owner asked Helper."""
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE plugins SET owner_user_id = :u WHERE id = :p"),
                {"u": pair["marko"].user_id, "p": pair["planner"]["plugin"]["id"]},
            )
        await ask_helper(
            pair,
            "@Helper ask Planner",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Planner", "text": "outline it"})),
                says("I cannot ask Planner."),
            ],
            planner=[says("I should never run.")],
        )
        assert "Error:" in tool_results(pair)[-1]
        assert "/planner" not in pair["state"]["seen"]
        assert not any("@Planner" in body for _, body in await bodies(pair))

    async def test_asking_itself_is_refused(self, pair: dict[str, Any]) -> None:
        await ask_helper(
            pair,
            "@Helper go",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Helper", "text": "loop"})),
                says("Fine."),
            ],
        )
        assert "That is you" in tool_results(pair)[-1]

    async def test_a_chain_at_its_depth_budget_asks_nobody(self, pair: dict[str, Any]) -> None:
        await set_depth(pair, 0)
        await ask_helper(
            pair,
            "@Helper plan it",
            agui=[
                calls(("c1", "ask_agent", {"agent": "Planner", "text": "outline it"})),
                says("I'll answer myself."),
            ],
            planner=[says("I should never run.")],
        )
        assert "as long as the workspace allows" in tool_results(pair)[-1]
        assert "/planner" not in pair["state"]["seen"]
        assert not any("@Planner" in body for _, body in await bodies(pair))


class TestListingAgents:
    async def test_a_person_sees_the_agents_they_may_ask_and_where_they_are(
        self, pair: dict[str, Any]
    ) -> None:
        mcp = Mcp(pair["owner"], await mint(pair["owner"]))
        listed = await mcp.call("list_agents", {"channel": "#general"})
        line_of = {line.split(" ")[1]: line for line in listed.splitlines()}
        assert set(line_of) == {"Helper", "Planner", "Scribe"}
        assert line_of["Planner"].endswith(" · in #general")
        assert line_of["Scribe"].endswith(" · not in #general")

    async def test_somebody_elses_own_agent_is_never_named(self, pair: dict[str, Any]) -> None:
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE plugins SET owner_user_id = :u WHERE id = :p"),
                {"u": pair["marko"].user_id, "p": pair["planner"]["plugin"]["id"]},
            )
        owners_view = await Mcp(pair["owner"], await mint(pair["owner"])).call("list_agents")
        assert "Planner" not in owners_view
        markos_view = await Mcp(pair["marko"], await mint(pair["marko"])).call("list_agents")
        assert "- Planner (theirs)" in markos_view

    async def test_an_agent_in_a_room_sees_only_who_is_in_that_room(
        self, pair: dict[str, Any]
    ) -> None:
        caller = await agent_caller(pair, pair["owner"], room=pair["general"])
        listed = await mcp_service.call(caller, "list_agents", {})
        assert "Planner" in listed and "Helper" in listed
        assert "Scribe" not in listed


def test_the_question_key_is_one_per_call_and_never_an_answer_key() -> None:
    first = agui_delegate.question_key("run-1", "call_" + "x" * 300)
    assert first == agui_delegate.question_key("run-1", "call_" + "x" * 300)
    assert first != agui_delegate.question_key("run-1", "call_" + "x" * 299 + "y")
    assert not first.startswith("agui:")
    assert len(first) < 64
