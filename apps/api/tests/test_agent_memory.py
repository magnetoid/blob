"""An agent remembers what it knew, per conversation.

Every run was cold. AG-UI shared state — the snapshot and deltas the fold already reads —
is now kept past the run: the last state an agent left in a conversation is what it is
handed at the start of its next run there. These pin the boundaries: per agent and per
conversation, written only by a run that shared state and finished, never by one that
failed, never past the size cap, and always outranked by a resume's own state.
"""

from __future__ import annotations

import json
from typing import Any

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


async def own_and_lend(agent: dict) -> None:
    """The agent becomes the owner's own, lent to the member in #general."""
    from blob_api.services import agent_access

    gave = await agent["owner"].put(
        f"/api/admin/plugins/{agent['plugin_id']}/owner", {"userId": agent["owner"].user_id}
    )
    assert gave.status == 200, gave.body
    async with SessionFactory() as session, session.begin():
        await agent_access.grant(
            session,
            workspace_id=agent["workspace_id"],
            plugin_id=agent["plugin_id"],
            grantee_user_id=agent["member"].user_id,
            granted_by=agent["owner"].user_id,
            channel_id=agent["general"],
        )


async def ask_as(agent: dict, who: Any, *chunks: bytes) -> None:
    transport, seen = streamed(*chunks)
    agent["slot"]["transport"] = transport
    agent["seen"] = seen
    sent = await send_message(who, agent["general"], "@Helper help me")
    await agui_job.handle_agui_run(str(sent.body["message"]["id"]))


class TestWhoseMemoryItIs:
    async def test_a_borrower_keeps_a_memory_of_their_own_and_never_the_owners(
        self, agent: dict
    ) -> None:
        # Memory was keyed by agent and conversation alone, so a lent agent was handed
        # whatever it remembered of its owner's work there — and the borrower's run
        # wrote over it. Then a borrowed run went without memory at all. Now an owned
        # agent remembers per person (migration 0050): a loan lends the agent, not what
        # it knows, and the borrower builds a memory of their own.
        await own_and_lend(agent)
        await ask(agent, *remembers({"owners": "plan"}))

        await ask_as(agent, agent["member"], *remembers({"borrowers": "notes"}))
        assert len(agent["seen"]) == 1, "the borrower may still command it"
        assert last_request_state(agent) is None

        await ask_as(agent, agent["member"], *ANSWER)
        assert last_request_state(agent) == {"borrowers": "notes"}
        await ask(agent, *ANSWER)
        assert last_request_state(agent) == {"owners": "plan"}

    async def test_the_workspaces_agent_still_remembers_the_conversation(self, agent: dict) -> None:
        # Nobody owns it, so its memory is the room's, whoever's run wrote it.
        await ask(agent, *remembers({"room": "notes"}))
        await ask_as(agent, agent["member"], *ANSWER)
        assert last_request_state(agent) == {"room": "notes"}


class TestSeeingAndClearingIt:
    async def test_a_person_sees_and_clears_only_their_own(self, agent: dict) -> None:
        await own_and_lend(agent)
        await ask(agent, *remembers({"owners": "plan"}))
        await ask_as(agent, agent["member"], *remembers({"borrowers": "notes"}))

        mine = (await agent["member"].get("/api/agents/memory")).body["memories"]
        assert [(m["agentName"], json.loads(m["preview"])) for m in mine] == [
            ("Helper", {"borrowers": "notes"})
        ]
        assert mine[0]["channelId"] == agent["general"] and mine[0]["inThread"] is False
        theirs = (await agent["owner"].get("/api/agents/memory")).body["memories"]
        assert [json.loads(m["preview"]) for m in theirs] == [{"owners": "plan"}]

        refused = await agent["member"].delete(f"/api/agents/memory/{theirs[0]['id']}")
        assert refused.status == 404, refused.body
        cleared = await agent["member"].delete(f"/api/agents/memory/{mine[0]['id']}")
        assert cleared.status == 200, cleared.body
        assert (await agent["member"].get("/api/agents/memory")).body["memories"] == []
        assert len((await agent["owner"].get("/api/agents/memory")).body["memories"]) == 1

        # And the next borrowed run starts cold.
        await ask_as(agent, agent["member"], *ANSWER)
        assert last_request_state(agent) is None

    async def test_clearing_everything_of_ones_own_leaves_everybody_elses(
        self, agent: dict
    ) -> None:
        await own_and_lend(agent)
        await ask(agent, *remembers({"owners": "plan"}))
        await ask_as(agent, agent["member"], *remembers({"borrowers": "notes"}))
        cleared = await agent["owner"].delete("/api/agents/memory")
        assert cleared.status == 200, cleared.body
        assert (await agent["owner"].get("/api/agents/memory")).body["memories"] == []
        assert len((await agent["member"].get("/api/agents/memory")).body["memories"]) == 1

    async def test_an_admin_sees_and_clears_a_conversations_memory(self, agent: dict) -> None:
        await ask(agent, *remembers({"room": "general"}))
        url = f"/api/admin/plugins/{agent['plugin_id']}/memory"
        listed = (await agent["owner"].get(url)).body["memories"]
        assert [json.loads(m["preview"]) for m in listed] == [{"room": "general"}]
        # Nobody's own: the workspace's agent remembers rooms, not people.
        assert (await agent["owner"].get("/api/agents/memory")).body["memories"] == []

        cleared = await agent["owner"].delete(f"{url}/{listed[0]['id']}")
        assert cleared.status == 200, cleared.body
        assert (await agent["owner"].get(url)).body["memories"] == []
        await ask(agent, *ANSWER)
        assert last_request_state(agent) is None

    async def test_a_private_room_keeps_its_memory_from_an_admin_who_is_not_in_it(
        self, agent: dict
    ) -> None:
        made = await agent["member"].post("/api/channels", {"name": "quiet", "kind": "private"})
        quiet = made.body["channel"]["id"]
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO agent_state
                        (id, plugin_id, thread_key, channel_id, workspace_id, state)
                    VALUES (:id, :p, :c, :c, :ws, '{"secret": 1}'::jsonb)
                    """
                ),
                {
                    "id": "01a11111-1111-7111-8111-111111111111",
                    "p": agent["plugin_id"],
                    "c": quiet,
                    "ws": agent["workspace_id"],
                },
            )
        url = f"/api/admin/plugins/{agent['plugin_id']}/memory"
        assert (await agent["owner"].get(url)).body["memories"] == []
        # Clearing everything reaches it, and says nothing of it.
        cleared = await agent["owner"].delete(url)
        assert cleared.status == 200, cleared.body
        assert await memory_rows() == []

    async def test_an_owned_agents_memory_with_nobody_on_it_is_still_not_the_admins(
        self, agent: dict
    ) -> None:
        # A row of an owned agent with no person on it — written before it had an owner, or
        # before migration 0050 set its owner on it — is not the room's to show an admin
        # (review of phase 5). The migration now names the owner; this is the second line.
        await ask(agent, *remembers({"before": "it was owned"}))
        await own_and_lend(agent)
        url = f"/api/admin/plugins/{agent['plugin_id']}/memory"
        assert (await agent["owner"].get(url)).body["memories"] == []
        cleared = await agent["owner"].delete(url)
        assert cleared.status == 200, cleared.body
        assert len(await memory_rows()) == 1

    async def test_clearing_an_agents_conversations_leaves_peoples_own(self, agent: dict) -> None:
        await own_and_lend(agent)
        await ask(agent, *remembers({"owners": "plan"}))
        cleared = await agent["owner"].delete(f"/api/admin/plugins/{agent['plugin_id']}/memory")
        assert cleared.status == 200, cleared.body
        assert len((await agent["owner"].get("/api/agents/memory")).body["memories"]) == 1


class TestHowLongItIsKept:
    async def test_a_memory_untouched_for_a_season_is_forgotten(self, agent: dict) -> None:
        from blob_api.db.engine import transaction
        from blob_api.services import agent_state as agent_state_service

        await ask(agent, *remembers({"old": True}))
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE agent_state SET updated_at = now() - make_interval(days => :d)"),
                {"d": agent_state_service.KEEP_DAYS + 1},
            )
        async with transaction() as (session, _after):
            assert await agent_state_service.sweep(session) == 1
        assert await memory_rows() == []

    async def test_a_memory_in_use_is_kept(self, agent: dict) -> None:
        from blob_api.db.engine import transaction
        from blob_api.services import agent_state as agent_state_service

        await ask(agent, *remembers({"fresh": True}))
        async with transaction() as (session, _after):
            assert await agent_state_service.sweep(session) == 0


class TestLoansYouCanSee:
    async def test_an_owner_sees_who_has_their_agent_and_ends_a_loan(self, agent: dict) -> None:
        from blob_api.services import agent_access

        await own_and_lend(agent)
        url = f"/api/agents/mine/{agent['plugin_id']}/loans"
        loans = (await agent["owner"].get(url)).body["loans"]
        assert [(loan["granteeName"], loan["channelId"]) for loan in loans] == [
            ("Member", agent["general"])
        ]
        # Whose agent it is stays private: anyone else is told there is no such agent.
        assert (await agent["member"].get(url)).status == 404

        ended = await agent["owner"].delete(f"{url}/{loans[0]['id']}")
        assert ended.status == 200, ended.body
        assert (await agent["owner"].get(url)).body["loans"] == []
        assert (await agent["owner"].delete(f"{url}/{loans[0]['id']}")).status == 404
        async with SessionFactory() as session:
            may = await agent_access.commandable_by(
                session,
                workspace_id=agent["workspace_id"],
                actor_id=agent["member"].user_id,
                channel_id=agent["general"],
                bot_user_ids=[agent["app"]["plugin"]["botUserId"]],
            )
        assert may == set()
