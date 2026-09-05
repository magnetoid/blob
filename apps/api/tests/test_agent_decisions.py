"""An agent stops to ask something, and the person who asked answers.

Until now `RUN_FINISHED{interrupt}` posted "Needs a decision" and that was the end of it:
nothing could be answered, and the run stayed `interrupted` for ever. These pin the other
half (ADR 0013): the question arrives with buttons Blob minted from what the agent
declared, only the person the run is on behalf of may press one, the answer is posted as
their own message, and the run resumes carrying `resume[]`, `parentRunId` and the state it
had when it stopped. A decision nobody makes expires.
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
from blob_api.plugins import agui, decisions, streams
from blob_api.services import workspace_agent

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of
from .test_agent_socket import agent_socket, receive_until
from .test_agent_socket import install as install_socket_agent
from .test_agui import (
    ANSWER,
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
    install,
    join_channel,
    messages_in,
)
from .test_builtin_agent import model  # noqa: F401 — a fixture, used by name


async def _nothing() -> None:
    """What a recorded `enqueue` hands to `fire_and_forget`: a coroutine that does nothing."""


def asks(
    *,
    schema: dict | None = None,
    message: str = "Deploy to prod?",
    item_id: str | None = "i1",
    expires_at: str | None = None,
    with_state: bool = True,
) -> tuple[bytes, ...]:
    """A run that shares some state and then stops to ask."""
    item: dict[str, Any] = {"message": message}
    if item_id:
        item["id"] = item_id
    if schema:
        item["responseSchema"] = schema
    if expires_at:
        item["expiresAt"] = expires_at
    chunks = [frame(type="RUN_STARTED", threadId="t", runId="r")]
    if with_state:
        chunks += [
            frame(type="STATE_SNAPSHOT", snapshot={"plan": ["build", "deploy"], "step": 1}),
            frame(type="STATE_DELTA", delta=[{"op": "replace", "path": "/step", "value": 2}]),
        ]
    chunks.append(frame(type="RUN_FINISHED", outcome={"type": "interrupt", "interrupts": [item]}))
    return tuple(chunks)


YES_NO = {"type": "boolean"}
#: The scope `interaction.triggered` requires (`plugins/manifest.py::EVENT_SCOPES`).
SCOPE = "messages:write"
ENVIRONMENTS = {"enum": ["staging", "production"]}


def streamed(*chunks: bytes) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)

        async def body() -> Any:
            for chunk in chunks:
                yield chunk

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())

    return httpx.MockTransport(handler), seen


@pytest_asyncio.fixture
async def agent(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    # Subscribed to `interaction.triggered`, so that a press wrongly forwarded to the agent
    # would leave an outbox row for the test to find. An agent that never asked for the
    # event would make that check pass for the wrong reason.
    app_body = await install(
        owner,
        events=["interaction.triggered"],
        scopes=sorted({"messages:read", "messages:write", "channels:read", "channels:join", SCOPE}),
    )
    await join_channel(owner, app_body, general)

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

    # Three places enqueue: the job and the answer service bind the name at import, and
    # `message_service.announce` imports it at call time from the queue module. All three
    # are patched, or a run started through `announce` goes to Redis unseen and a test
    # asserting "only one run was started" cannot fail.
    from blob_api.lib import queue as queue_module
    from blob_api.services import agent_chains

    monkeypatch.setattr(agui_job, "enqueue", record)
    monkeypatch.setattr(agent_chains, "enqueue", record)
    monkeypatch.setattr(queue_module, "enqueue", record)

    return {
        "owner": owner,
        "member": member,
        "general": general,
        "app": app_body,
        "plugin_id": app_body["plugin"]["id"],
        "slot": slot,
        "enqueued": enqueued,
        "workspace_id": await workspace_id_of(owner),
    }


async def ask(agent: dict, *chunks: bytes) -> str:
    transport, seen = streamed(*chunks)
    agent["slot"]["transport"] = transport
    agent["seen"] = seen
    sent = await send_message(agent["owner"], agent["general"], "@Helper shall we?")
    trigger_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(trigger_id)
    return trigger_id


async def the_run(agent: dict) -> dict:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, status, interrupt, state, expires_at, answered_at,
                           decision_message_id, trigger_message_id, started_at
                      FROM agent_runs WHERE plugin_id = :p
                     ORDER BY started_at DESC LIMIT 1
                    """
                ),
                {"p": agent["plugin_id"]},
            )
        ).fetchone()
    assert row is not None
    return dict(row._mapping)


async def blocks_of(message_id: str) -> list[dict]:
    async with SessionFactory() as session:
        blocks = (
            await session.execute(
                text("SELECT blocks FROM messages WHERE id = :id"), {"id": message_id}
            )
        ).scalar_one()
    return list(blocks or [])


async def answer_message(run_id: str) -> dict | None:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, body, kind, author_id, client_msg_id FROM messages
                     WHERE client_msg_id LIKE :prefix
                    """
                ),
                {"prefix": f"agent-answer:{run_id}:%"},
            )
        ).fetchone()
    return None if row is None else dict(row._mapping)


def button(run_id: str, index: int) -> str:
    return f"{decisions.ACTION_PREFIX}{run_id}:{index}"


async def press(
    agent: dict, who: Client, run: dict, index: int = 0, client_action_id: str = "click-1"
) -> Any:
    return await who.post(
        "/api/interactions",
        {
            "messageId": str(run["decision_message_id"]),
            "actionId": button(str(run["id"]), index),
            "value": "",
            "clientActionId": client_action_id,
        },
    )


async def resume(agent: dict, run: dict, *chunks: bytes) -> list[httpx.Request]:
    """Drive the resume the answer enqueued, as the worker would, and return its requests."""
    transport, seen = streamed(*chunks)
    agent["slot"]["transport"] = transport
    answered = await answer_message(str(run["id"]))
    assert answered is not None
    await agui_job.handle_agui_run(str(answered["id"]), str(run["id"]))
    return seen


# ─── the shape of a decision, as arithmetic ───────────────────────────────────
class TestWhatTheButtonsAre:
    def test_a_schema_enum_becomes_buttons(self) -> None:
        decision = agui.decision_of(
            [{"id": "i1", "message": "Where?", "responseSchema": ENVIRONMENTS}]
        )
        [_, actions] = decisions.decision_blocks("run", decision)
        labels = [e["text"] for e in actions["elements"]]
        assert labels == ["staging", "production"]
        assert actions["elements"][0]["actionId"] == "agent_answer:run:0"

    def test_a_boolean_becomes_yes_and_no(self) -> None:
        decision = agui.decision_of([{"message": "Deploy?", "responseSchema": YES_NO}])
        [_, actions] = decisions.decision_blocks("run", decision)
        assert [e["text"] for e in actions["elements"]] == ["Yes", "No"]
        # The channel reads "Yes"; the agent receives true.
        assert decisions.payload_for(decision, "agent_answer:run:0", "") == ("Yes", True)

    def test_no_schema_becomes_a_text_input(self) -> None:
        decision = agui.decision_of([{"message": "Which customer?"}])
        [_, field] = decisions.decision_blocks("run", decision)
        assert field["type"] == "input"
        assert decisions.payload_for(decision, field["actionId"], "  Acme  ") == ("Acme", "Acme")

    def test_a_one_of_with_titles_uses_the_titles(self) -> None:
        schema = {"oneOf": [{"const": "eu-1", "title": "Europe"}, {"const": "us-1", "title": "US"}]}
        decision = agui.decision_of([{"message": "Region?", "responseSchema": schema}])
        assert [c.label for c in decision.choices] == ["Europe", "US"]
        assert decisions.payload_for(decision, "agent_answer:run:1", "") == ("US", "us-1")

    def test_choices_are_never_invented_from_prose(self) -> None:
        decision = agui.decision_of([{"message": "Should I use staging or production?"}])
        assert decision.free_text

    def test_a_choice_that_is_not_on_offer_is_refused(self) -> None:
        decision = agui.decision_of([{"message": "Deploy?", "responseSchema": YES_NO}])
        with pytest.raises(Exception) as caught:
            decisions.payload_for(decision, "agent_answer:run:7", "")
        assert "not on offer" in str(caught.value)

    def test_the_action_id_names_its_run(self) -> None:
        assert decisions.run_id_of("agent_answer:abc:0") == "abc"
        assert decisions.run_id_of("agent_answer:abc:text") == "abc"
        assert decisions.run_id_of("deploy_button") is None


# ─── the round trip ───────────────────────────────────────────────────────────
class TestAskingAndAnswering:
    async def test_an_interrupt_stores_its_question_and_its_state(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO))

        run = await the_run(agent)
        assert run["status"] == "interrupted"
        assert run["interrupt"]["items"][0]["id"] == "i1"
        # The snapshot with the delta applied — what the agent knew when it stopped.
        assert run["state"] == {"plan": ["build", "deploy"], "step": 2}
        assert run["expires_at"] is not None
        assert run["decision_message_id"] is not None
        [_, actions] = await blocks_of(str(run["decision_message_id"]))
        assert [e["text"] for e in actions["elements"]] == ["Yes", "No"]

    async def test_the_asker_answers_and_the_agent_resumes_with_state(self, agent: dict) -> None:
        trigger_id = await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)

        pressed = await press(agent, agent["owner"], run)
        assert pressed.status == 200, pressed.body

        # The decision is a message from the person, in their words, for the channel.
        answered = await answer_message(str(run["id"]))
        assert answered is not None
        assert answered["kind"] == "user"
        assert answered["author_id"] == agent["owner"].user_id
        assert answered["body"] == "Yes"
        # The card settled: no buttons, and who decided.
        [_, context] = await blocks_of(str(run["decision_message_id"]))
        assert context["type"] == "context"
        assert "Owner answered: Yes" in context["elements"][0]["text"]
        assert (await the_run(agent))["answered_at"] is not None

        seen = await resume(agent, run, *ANSWER)

        [request] = seen
        body = json.loads(request.content)
        assert body["parentRunId"] == trigger_id
        assert body["threadId"] == agent["general"]
        assert body["state"] == {"plan": ["build", "deploy"], "step": 2}
        assert body["resume"] == [{"interruptId": "i1", "status": "resolved", "payload": True}]
        # The answer is the newest turn the agent sees, from the person.
        assert body["messages"][-1]["content"] == "Yes"
        assert body["messages"][-1]["role"] == "user"
        assert "Standup is at nine." in [m["body"] for m in await messages_in(agent["general"])]

    async def test_a_resume_is_not_a_hop(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)
        await press(agent, agent["owner"], run)
        await resume(agent, run, *ANSWER)

        async with SessionFactory() as session:
            rows = (
                await session.execute(
                    text(
                        "SELECT depth, chain_id, parent_run_id FROM agent_runs ORDER BY started_at"
                    )
                )
            ).fetchall()
        assert [r.depth for r in rows] == [0, 0]
        assert rows[0].chain_id == rows[1].chain_id
        assert str(rows[1].parent_run_id) == str(run["id"])

    async def test_resumed_posts_have_distinct_client_ids(self, agent: dict) -> None:
        # Both runs post an AG-UI message called "m1"; the run id in the client id is what
        # keeps the second from deduping against the first and vanishing.
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)
        await press(agent, agent["owner"], run)
        await resume(agent, run, *ANSWER)
        await resume(agent, run, *ANSWER)  # A retry of the same job posts nothing new.

        assert [m["body"] for m in await messages_in(agent["general"])].count(
            "Standup is at nine."
        ) == 1

    async def test_the_rest_route_is_the_same_entrance(self, agent: dict) -> None:
        await ask(agent, *asks())  # free text
        run = await the_run(agent)

        answered = await agent["owner"].post(
            f"/api/agent-runs/{run['id']}/answer", {"value": "Ship it to Acme first"}
        )

        assert answered.status == 200, answered.body
        message = await answer_message(str(run["id"]))
        assert message is not None and message["body"] == "Ship it to Acme first"
        seen = await resume(agent, run, *ANSWER)
        assert json.loads(seen[0].content)["resume"][0]["payload"] == "Ship it to Acme first"

    async def test_the_answer_does_not_root_a_second_run(self, agent: dict) -> None:
        await ask(agent, *asks())
        run = await the_run(agent)
        agent["enqueued"].clear()

        # Mentioning the agent in the answer would, through the ordinary send path, start
        # a fresh chain racing the resume for the same agent. It must not.
        await agent["owner"].post(f"/api/agent-runs/{run['id']}/answer", {"value": "@Helper yes"})

        starts = [e for e in agent["enqueued"] if e[0] == "agui_run"]
        assert len(starts) == 1
        assert starts[0][2] == str(run["id"])  # the resume, and only the resume

    async def test_a_resume_runs_only_the_agent_that_asked(
        self, agent: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        other = await install(
            agent["owner"],
            slug="planner",
            name="Planner",
            aguiUrl="https://apps.example.com/planner",
        )
        await join_channel(agent["owner"], other, agent["general"])
        await ask(agent, *asks())
        run = await the_run(agent)
        await agent["owner"].post(
            f"/api/agent-runs/{run['id']}/answer", {"value": "@Planner take over"}
        )

        seen = await resume(agent, run, *ANSWER)

        assert [r.url.path for r in seen] == ["/agui"]


class TestWhoMayAnswer:
    async def test_somebody_else_cannot(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)

        refused = await press(agent, agent["member"], run)

        assert refused.status == 403, refused.body
        assert await answer_message(str(run["id"])) is None
        assert (await the_run(agent))["answered_at"] is None

    async def test_a_second_answer_is_refused(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)
        assert (await press(agent, agent["owner"], run, 0, "first")).status == 200

        # The settled card carries no buttons any more, so a press is an unknown action —
        # the same refusal any stale button gets.
        again = await press(agent, agent["owner"], run, 1, "second")
        assert again.status == 400, again.body
        assert again.body["error"]["code"] == "unknown_action"

        # The REST entrance, which has no blocks to consult, says what actually happened.
        by_route = await agent["owner"].post(f"/api/agent-runs/{run['id']}/answer", {"value": "No"})
        assert by_route.status == 409, by_route.body
        assert by_route.body["error"]["code"] == "run_not_waiting"
        assert await answer_message(str(run["id"])) is not None

    async def test_the_same_click_twice_is_one_decision(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)
        assert (await press(agent, agent["owner"], run, 0, "same")).status == 200

        # A retry of the same click is answered ok and changes nothing.
        assert (await press(agent, agent["owner"], run, 0, "same")).status == 200
        starts = [e for e in agent["enqueued"] if e[0] == "agui_run" and len(e) == 3]
        assert len(starts) == 1

    async def test_a_pressed_decision_is_not_webhooked_to_the_agent(self, agent: dict) -> None:
        # The decision message's plugin_id is the agent's. Without the branch in the
        # interactions route the press would be delivered to the agent as an interaction
        # on a button it never published.
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)
        await press(agent, agent["owner"], run)

        async with SessionFactory() as session:
            webhooked = (
                await session.execute(
                    text(
                        "SELECT count(*) FROM plugin_deliveries "
                        "WHERE plugin_id = :p AND event = 'interaction.triggered'"
                    ),
                    {"p": agent["plugin_id"]},
                )
            ).scalar_one()
        assert webhooked == 0


class TestWaiting:
    async def test_a_waiting_run_stays_listed_past_an_hour(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO))
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE agent_runs SET started_at = now() - interval '2 hours'")
                )

        listed = (await agent["owner"].get(f"/api/channels/{agent['general']}/agent-runs")).body
        [view] = listed["runs"]
        assert view["status"] == "interrupted"
        assert view["answeredAt"] is None
        assert view["expiresAt"] is not None

    async def test_an_expired_decision_is_refused(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE agent_runs SET expires_at = now() - interval '1 minute'")
                )

        late = await press(agent, agent["owner"], run)

        assert late.status == 409, late.body
        assert "expired" in late.body["error"]["message"]

    async def test_the_sweep_expires_waiting_runs_and_settles_their_cards(
        self, agent: dict
    ) -> None:
        await ask(agent, *asks(schema=YES_NO))
        run = await the_run(agent)
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE agent_runs SET expires_at = now() - interval '1 minute'")
                )

        expired = await agui_job.expire_agent_decisions()

        assert expired == 1
        assert (await the_run(agent))["status"] == "expired"
        [_, context] = await blocks_of(str(run["decision_message_id"]))
        assert "Nobody answered" in context["elements"][0]["text"]

    async def test_the_agents_own_deadline_wins_when_it_is_sooner(self, agent: dict) -> None:
        await ask(agent, *asks(schema=YES_NO, expires_at="2026-01-01T00:00:00Z"))
        run = await the_run(agent)
        assert run["expires_at"].year == 2026 and run["expires_at"].month == 1


class TestTheOtherTransports:
    async def test_the_builtin_gets_the_answer_as_its_next_turn(
        self,
        client: Client,
        model: dict,  # noqa: F811 — the fixture, by name
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        owner = await sign_up(client, "Ada")
        general = (await owner.get("/api/channels")).body["channels"][0]["id"]
        inputs: list[dict] = []

        async def fake_stream(run_input: Any, persona: Any) -> Any:
            inputs.append(dict(run_input))
            yield {"type": "RUN_STARTED", "threadId": "t", "runId": "r"}
            if len(inputs) == 1:
                yield {
                    "type": "RUN_FINISHED",
                    "outcome": {
                        "type": "interrupt",
                        "interrupts": [{"id": "q", "message": "Which repo?"}],
                    },
                }
            else:
                yield {"type": "TEXT_MESSAGE_START", "messageId": "m1", "role": "assistant"}
                yield {"type": "TEXT_MESSAGE_CONTENT", "messageId": "m1", "delta": "On it."}
                yield {"type": "TEXT_MESSAGE_END", "messageId": "m1"}
                yield {"type": "RUN_FINISHED", "threadId": "t", "runId": "r"}

        monkeypatch.setattr(streams.builtin, "stream", fake_stream)
        recorded: list[tuple[Any, ...]] = []

        def record(job: str, *args: Any) -> Any:
            recorded.append((job, *args))
            return _nothing()

        from blob_api.services import agent_chains

        monkeypatch.setattr(agent_chains, "enqueue", record)

        sent = await send_message(
            owner, general, f"@{workspace_agent.AGENT_NAME} start the release"
        )
        await agui_job.handle_agui_run(str(sent.body["message"]["id"]))
        async with SessionFactory() as session:
            run_id = (
                await session.execute(
                    text("SELECT id FROM agent_runs WHERE status = 'interrupted'")
                )
            ).scalar_one()

        answered = await owner.post(f"/api/agent-runs/{run_id}/answer", {"value": "blob/main"})
        assert answered.status == 200, answered.body
        [(_, answer_id, parent)] = [r for r in recorded if r[0] == "agui_run"]
        await agui_job.handle_agui_run(answer_id, parent)

        assert len(inputs) == 2
        # The built-in ignores `resume` and simply reads the answer as the newest turn.
        assert inputs[1]["messages"][-1]["content"] == "blob/main"
        assert inputs[1]["resume"][0]["payload"] == "blob/main"
        assert "On it." in [m["body"] for m in await messages_in(general)]

    async def test_a_socket_agent_receives_the_resume_input(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        owner = await sign_up(client, "Owner")
        general = (await owner.get("/api/channels")).body["channels"][0]["id"]
        body = await install_socket_agent(owner)
        await join_channel(owner, body, general)
        recorded: list[tuple[Any, ...]] = []

        def record(job: str, *args: Any) -> Any:
            recorded.append((job, *args))
            return _nothing()

        from blob_api.services import agent_chains

        monkeypatch.setattr(agent_chains, "enqueue", record)

        async with agent_socket(body["botToken"]) as ws:
            await receive_until(ws, "ready")
            sent = await send_message(owner, general, "@Desktop deploy?")
            job = asyncio.create_task(agui_job.handle_agui_run(str(sent.body["message"]["id"])))
            run = await receive_until(ws, "run")
            for event in (
                {"type": "RUN_STARTED", "threadId": "t", "runId": "r"},
                {"type": "STATE_SNAPSHOT", "snapshot": {"target": None}},
                {
                    "type": "RUN_FINISHED",
                    "outcome": {
                        "type": "interrupt",
                        "interrupts": [
                            {"id": "env", "message": "Where?", "responseSchema": ENVIRONMENTS}
                        ],
                    },
                },
            ):
                await ws.send_text(
                    json.dumps({"t": "event", "runId": run["runId"], "event": event})
                )
            await ws.send_text(json.dumps({"t": "done", "runId": run["runId"]}))
            await asyncio.wait_for(job, timeout=10.0)

            async with SessionFactory() as session:
                waiting = (
                    await session.execute(
                        text(
                            "SELECT id, decision_message_id FROM agent_runs "
                            "WHERE status = 'interrupted'"
                        )
                    )
                ).fetchone()
            assert waiting is not None
            pressed = await owner.post(
                "/api/interactions",
                {
                    "messageId": str(waiting.decision_message_id),
                    "actionId": button(str(waiting.id), 1),
                    "value": "",
                },
            )
            assert pressed.status == 200, pressed.body
            [(_, answer_id, parent)] = [r for r in recorded if r[0] == "agui_run"]

            job = asyncio.create_task(agui_job.handle_agui_run(answer_id, parent))
            resumed = await receive_until(ws, "run")
            assert resumed["input"]["resume"] == [
                {"interruptId": "env", "status": "resolved", "payload": "production"}
            ]
            assert resumed["input"]["state"] == {"target": None}
            assert resumed["input"]["parentRunId"] == sent.body["message"]["id"]
            for event in (
                {"type": "RUN_STARTED", "threadId": "t", "runId": "r"},
                {"type": "RUN_FINISHED", "threadId": "t", "runId": "r"},
            ):
                await ws.send_text(
                    json.dumps({"t": "event", "runId": resumed["runId"], "event": event})
                )
            await ws.send_text(json.dumps({"t": "done", "runId": resumed["runId"]}))
            await asyncio.wait_for(job, timeout=10.0)
