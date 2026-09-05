"""An agent remembers what it knew, per conversation.

Every run was cold. AG-UI shared state — the snapshot and deltas the fold already reads —
is now kept past the run: the last state an agent left in a conversation is what it is
handed at the start of its next run there. These pin the boundaries: per agent and per
conversation, written only by a run that shared state and finished, never by one that
failed, never past the size cap, and always outranked by a resume's own state.
"""

from __future__ import annotations

import json

from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import agui

from .helpers import send_message
from .test_agent_decisions import (
    YES_NO,
    ask,
    asks,
    press,
    resume,
    streamed,
    the_run,
)
from .test_agent_decisions import agent as _agent_fixture
from .test_agui import (
    ANSWER,
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
)

# Pytest registers a fixture under the name of the function that defines it, so binding
# the imported fixture to another module attribute still offers `agent` to the tests
# here — without every test's `agent: dict` parameter reading as a redefinition.
agent = _agent_fixture


def remembers(state: dict) -> tuple[bytes, ...]:
    """A run that shares some state and answers."""
    return (
        frame(type="RUN_STARTED", threadId="t", runId="r"),
        frame(type="STATE_SNAPSHOT", snapshot=state),
        *ANSWER[1:],
    )


def last_request_state(agent: dict) -> object:
    return json.loads(agent["seen"][-1].content)["state"]


async def memory_rows() -> list[dict]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT plugin_id, thread_key, state FROM agent_state ORDER BY updated_at")
            )
        ).fetchall()
    return [dict(r._mapping) for r in rows]


class TestWhatIsRemembered:
    async def test_state_shared_in_one_run_reaches_the_next_in_the_same_conversation(
        self, agent: dict
    ) -> None:
        await ask(agent, *remembers({"plan": ["build", "deploy"], "step": 1}))
        assert last_request_state(agent) is None  # the first run started cold

        await ask(agent, *ANSWER)

        assert last_request_state(agent) == {"plan": ["build", "deploy"], "step": 1}

    async def test_deltas_are_applied_before_it_is_kept(self, agent: dict) -> None:
        await ask(
            agent,
            frame(type="RUN_STARTED", threadId="t", runId="r"),
            frame(type="STATE_SNAPSHOT", snapshot={"step": 1}),
            frame(type="STATE_DELTA", delta=[{"op": "replace", "path": "/step", "value": 3}]),
            *ANSWER[1:],
        )
        await ask(agent, *ANSWER)
        assert last_request_state(agent) == {"step": 3}

    async def test_a_run_that_shares_nothing_leaves_the_memory_alone(self, agent: dict) -> None:
        await ask(agent, *remembers({"kept": True}))
        await ask(agent, *ANSWER)  # shares no state
        await ask(agent, *ANSWER)

        assert last_request_state(agent) == {"kept": True}

    async def test_the_newest_state_replaces_the_old_whole(self, agent: dict) -> None:
        await ask(agent, *remembers({"a": 1, "b": 2}))
        await ask(agent, *remembers({"c": 3}))
        await ask(agent, *ANSWER)

        assert last_request_state(agent) == {"c": 3}
        assert len(await memory_rows()) == 1


class TestWhereItIsRemembered:
    async def test_a_thread_is_its_own_conversation(self, agent: dict) -> None:
        await ask(agent, *remembers({"channel": "wide"}))

        transport, seen = streamed(*ANSWER)
        agent["slot"]["transport"] = transport
        root = await send_message(agent["owner"], agent["general"], "a thread starts here")
        reply = await send_message(
            agent["owner"],
            agent["general"],
            "@Helper in here?",
            threadRootId=root.body["message"]["id"],
        )
        await agui_job.handle_agui_run(str(reply.body["message"]["id"]))

        # Cold in the thread: what the agent remembered was the channel's, not this one's.
        assert json.loads(seen[0].content)["state"] is None
        assert json.loads(seen[0].content)["threadId"] == root.body["message"]["id"]

    async def test_memory_is_per_agent(self, agent: dict) -> None:
        # Two rows for two conversations of one agent; another agent would have its own.
        await ask(agent, *remembers({"one": 1}))
        rows = await memory_rows()
        assert len(rows) == 1
        assert str(rows[0]["plugin_id"]) == agent["plugin_id"]
        assert str(rows[0]["thread_key"]) == agent["general"]


class TestWhatIsNot:
    async def test_a_failed_run_does_not_overwrite_what_was_remembered(self, agent: dict) -> None:
        await ask(agent, *remembers({"good": True}))
        await ask(
            agent,
            frame(type="RUN_STARTED", threadId="t", runId="r"),
            frame(type="STATE_SNAPSHOT", snapshot={"half": "baked"}),
            frame(type="RUN_ERROR", message="the model refused"),
        )
        await ask(agent, *ANSWER)

        assert last_request_state(agent) == {"good": True}

    async def test_state_over_the_cap_is_not_remembered(self, agent: dict) -> None:
        big = {"blob": "x" * (agui.STATE_MAX_BYTES + 1)}
        await ask(agent, *remembers(big))
        await ask(agent, *ANSWER)

        assert last_request_state(agent) is None
        assert await memory_rows() == []

    async def test_a_resume_carries_the_state_it_stopped_with_not_the_memory(
        self, agent: dict
    ) -> None:
        await ask(agent, *remembers({"remembered": "earlier"}))
        await ask(agent, *asks(schema=YES_NO))  # shares {"plan": [...], "step": 2} then asks
        run = await the_run(agent)
        await press(agent, agent["owner"], run)

        seen = await resume(agent, run, *ANSWER)

        # The run's own state when it stopped, newer than anything saved.
        assert json.loads(seen[0].content)["state"] == {"plan": ["build", "deploy"], "step": 2}
        # And an interrupted run is a considered state too, so it is what is remembered.
        await ask(agent, *ANSWER)
        assert last_request_state(agent) == {"plan": ["build", "deploy"], "step": 2}
