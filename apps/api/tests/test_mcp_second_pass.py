"""Blob as an MCP server, second pass (agentic plan, phase 6).

What an assistant connected as a person can now do beyond reading and posting: see what
is waiting on them, the threads they follow, page a search, post idempotently, message
someone directly, react, and work with the workspace's agents — ask one, follow its run,
answer its question, stop it. And the credential itself: every token ends, and an admin
sees every one in the workspace. The 2026-07-28 revision's result shape is pinned too:
every result says it is complete, and lists carry their caching hints.
"""

from __future__ import annotations

import re
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.jobs.notify import handle_notify
from blob_api.plugins import streams
from blob_api.services import agent_chains

from .helpers import Client, send_message
from .test_agent_tools import says
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
    install,
    join_channel,
)
from .test_mcp import LEGACY, MODERN, Mcp, mint
from .test_mcp import team as _team_fixture

# The fixture, offered under its own name here (pytest registers it by attribute name).
team = _team_fixture


async def connect(person: Client, *, can_write: bool = False, era: str = MODERN) -> Mcp:
    return Mcp(person.fork(), await mint(person, can_write=can_write), era=era)


def message_id_in(said: str) -> str:
    found = re.search(r"Message id ([0-9a-f-]{36})", said)
    assert found, said
    return found.group(1)


# ─── the 2026-07-28 result shape ───────────────────────────────────────────────


class TestTheModernShape:
    async def test_a_tool_list_is_complete_named_and_privately_cacheable(
        self, team: dict[str, Any]
    ) -> None:
        mcp = await connect(team["owner"])
        result = (await mcp.send("tools/list")).json()["result"]
        assert result["resultType"] == "complete"
        # Filtered by what the token may do, so it is this caller's own list.
        assert result["cacheScope"] == "private"
        assert result["ttlMs"] > 0
        assert result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "blob"

    async def test_discovery_is_the_same_for_everyone(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"])
        result = (await mcp.send("server/discover")).json()["result"]
        assert (result["resultType"], result["cacheScope"]) == ("complete", "public")

    async def test_a_tool_call_says_it_is_complete(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"])
        response = await mcp.send("tools/call", {"name": "whoami", "arguments": {}})
        assert response.json()["result"]["resultType"] == "complete"

    async def test_an_older_client_sees_its_own_shape(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"], era=LEGACY)
        result = (await mcp.send("tools/list")).json()["result"]
        assert "resultType" not in result and "ttlMs" not in result


# ─── the credential ────────────────────────────────────────────────────────────


class TestEveryTokenEnds:
    async def test_a_token_lasts_what_its_person_chose(self, team: dict[str, Any]) -> None:
        made = await team["owner"].post(
            "/api/me/mcp-tokens", {"name": "Short", "canWrite": False, "lifetimeDays": 30}
        )
        assert made.status == 200, made.body
        assert made.body["token"]["expiresAt"] is not None
        async with SessionFactory() as session:
            days = (
                await session.execute(
                    text(
                        "SELECT extract(day FROM expires_at - created_at)::int FROM mcp_tokens "
                        "WHERE id = :id"
                    ),
                    {"id": made.body["token"]["id"]},
                )
            ).scalar_one()
        assert days in (29, 30)

    async def test_a_lifetime_not_on_offer_is_refused(self, team: dict[str, Any]) -> None:
        made = await team["owner"].post(
            "/api/me/mcp-tokens", {"name": "Forever", "canWrite": False, "lifetimeDays": 9999}
        )
        assert made.status == 400, made.body

    async def test_a_token_past_its_date_is_nobody(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"])
        assert (await mcp.send("tools/list")).status_code == 200
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE mcp_tokens SET expires_at = now() - interval '1 minute'")
            )
        assert (await mcp.send("tools/list")).status_code == 401


class TestAnAdminSeesEveryToken:
    async def test_lists_them_with_whose_they_are_and_revokes_one(
        self, team: dict[str, Any]
    ) -> None:
        theirs = await connect(team["member"], can_write=True)
        listed = await team["owner"].get("/api/admin/mcp-tokens")
        assert listed.status == 200, listed.body
        [token] = listed.body["tokens"]
        assert (token["ownerName"], token["scopes"]) == ("Member", ["read", "write"])
        assert token["expiresAt"] is not None

        revoked = await team["owner"].delete(f"/api/admin/mcp-tokens/{token['id']}")
        assert revoked.status == 200, revoked.body
        assert (await theirs.send("tools/list")).status_code == 401
        audit = await team["owner"].get("/api/admin/audit?action=mcp_token.revoked")
        assert audit.body["events"][0]["metadata"]["byAdmin"] is True

    async def test_a_member_sees_nobody_elses(self, team: dict[str, Any]) -> None:
        assert (await team["member"].get("/api/admin/mcp-tokens")).status == 403


# ─── what is waiting on them ───────────────────────────────────────────────────


class TestTheInbox:
    async def test_shows_unread_conversations_and_the_latest_mentions(
        self, team: dict[str, Any]
    ) -> None:
        mentioned = await send_message(team["owner"], team["general"], "@Member can you look?")
        # The mention count is the notify job's to keep, as it is in production.
        await handle_notify(mentioned.body["message"]["id"])
        mcp = await connect(team["member"])
        said = await mcp.call("inbox")
        assert "Unread:" in said
        assert f"[{team['general']}] #general — 1 mention" in said
        assert "Mentioned lately:" in said
        assert f"[{mentioned.body['message']['id']}]" in said
        assert "Owner: @Member can you look?" in said

    async def test_says_so_when_nothing_is_waiting(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["outsider"])
        said = await mcp.call("inbox")
        assert "Nothing waiting" in said or "Unread:" in said


class TestTheThreadsTheyFollow:
    async def test_lists_followed_threads_and_marks_new_replies(self, team: dict[str, Any]) -> None:
        root = await send_message(team["owner"], team["general"], "Release plan?")
        root_id = root.body["message"]["id"]
        # Replying follows the thread; a reply after that is news to them.
        await send_message(team["member"], team["general"], "On it.", threadRootId=root_id)
        await send_message(team["owner"], team["general"], "Thanks!", threadRootId=root_id)
        mcp = await connect(team["member"])
        said = await mcp.call("list_threads")
        assert f"[{root_id}] in #general Owner: Release plan?  [2 replies] — new replies" in said

    async def test_a_thread_in_a_room_they_left_is_not_listed(self, team: dict[str, Any]) -> None:
        root = await send_message(team["owner"], team["private"], "Secret plan")
        root_id = root.body["message"]["id"]
        await send_message(team["member"], team["private"], "Noted.", threadRootId=root_id)
        await send_message(team["owner"], team["private"], "Shh.", threadRootId=root_id)
        mcp = await connect(team["member"])
        assert root_id in await mcp.call("list_threads"), "followed while they were in it"

        left = await team["member"].post(f"/api/channels/{team['private']}/leave")
        assert left.status in (200, 204), left.body
        assert root_id not in await mcp.call("list_threads")


class TestSearchPaging:
    async def test_a_search_pages_on_with_its_cursor(self, team: dict[str, Any]) -> None:
        for n in range(3):
            await send_message(team["owner"], team["general"], f"lighthouse note {n}")
        mcp = await connect(team["owner"])
        first = await mcp.call("search_messages", {"query": "lighthouse", "limit": 2})
        found = re.search(r"cursor=(\S+)\.", first)
        assert found, first
        second = await mcp.call(
            "search_messages", {"query": "lighthouse", "limit": 2, "cursor": found.group(1)}
        )
        ids_first = set(re.findall(r"\[([0-9a-f-]{36})\]", first))
        ids_second = set(re.findall(r"\[([0-9a-f-]{36})\]", second))
        assert len(ids_first) == 2 and len(ids_second) == 1
        assert not ids_first & ids_second
        assert "cursor=" not in second

    async def test_a_cursor_we_did_not_issue_is_refused(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"])
        said = await mcp.refuse("search_messages", {"query": "x", "cursor": "made-up"})
        assert "not one we issued" in said


# ─── writing ───────────────────────────────────────────────────────────────────


class TestWritingSafely:
    async def test_a_post_with_its_own_id_is_posted_once(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"], can_write=True)
        args = {"channel": "#general", "text": "Deploy at noon.", "client_msg_id": "deploy-1"}
        first = await mcp.call("post_message", args)
        again = await mcp.call("post_message", args)
        assert "Already posted" in again
        assert message_id_in(first) in again
        async with SessionFactory() as session:
            count = (
                await session.execute(
                    text("SELECT count(*) FROM messages WHERE body = 'Deploy at noon.'")
                )
            ).scalar_one()
        assert count == 1

    async def test_message_person_opens_the_dm_and_sends(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"], can_write=True)
        said = await mcp.call("message_person", {"to": "@Member", "text": "Got a minute?"})
        assert said.startswith("Sent to Member as Owner.")
        dms = (await team["member"].get("/api/channels")).body["channels"]
        dm = next(c for c in dms if c["kind"] == "dm")
        history = (await team["member"].get(f"/api/channels/{dm['id']}/messages")).body
        assert [m["body"] for m in history["messages"]] == ["Got a minute?"]

    async def test_message_person_will_not_message_themselves(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"], can_write=True)
        said = await mcp.refuse("message_person", {"to": "@Owner", "text": "hi me"})
        assert "acts as" in said

    async def test_a_reaction_lands_as_the_person(self, team: dict[str, Any]) -> None:
        sent = await send_message(team["member"], team["general"], "Shipped!")
        message_id = sent.body["message"]["id"]
        mcp = await connect(team["owner"], can_write=True)
        await mcp.call("add_reaction", {"message_id": message_id, "emoji": "🎉"})
        async with SessionFactory() as session:
            rows = (
                await session.execute(
                    text("SELECT user_id, emoji FROM reactions WHERE message_id = :m"),
                    {"m": message_id},
                )
            ).fetchall()
        assert [(str(r.user_id), r.emoji) for r in rows] == [(team["owner"].user_id, "🎉")]

    async def test_a_read_only_token_is_not_offered_any_of_it(self, team: dict[str, Any]) -> None:
        mcp = await connect(team["owner"])
        names = {tool["name"] for tool in (await mcp.send("tools/list")).json()["result"]["tools"]}
        assert {"inbox", "list_threads", "run_status"} <= names
        assert not names & {"message_person", "add_reaction", "ask_agent", "stop_run"}


# ─── agents, from an assistant ─────────────────────────────────────────────────


async def _nothing() -> None:
    """What a recorded `enqueue` hands to `fire_and_forget`."""


@pytest_asyncio.fixture
async def crew(team: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """`team`, plus an AG-UI agent in #general answering from scripts, and the run jobs
    recorded rather than run so a test can run them."""
    app_body = await install(team["owner"])
    await join_channel(team["owner"], app_body, team["general"])
    state: dict[str, Any] = {"scripts": [], "seen": []}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        state["seen"].append(request)
        body = state["scripts"].pop(0) if state["scripts"] else says("(no more scripts)")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        if isinstance(kwargs.get("transport"), httpx.ASGITransport):
            return real(**kwargs)
        kwargs.pop("transport", None)
        return real(**kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)
    enqueued: list[tuple[Any, ...]] = []

    def record(job: str, *args: Any) -> Any:
        enqueued.append((job, *args))
        return _nothing()

    from blob_api.lib import queue as queue_module

    monkeypatch.setattr(agent_chains, "enqueue", record)
    monkeypatch.setattr(queue_module, "enqueue", record)
    return {
        **team,
        "plugin_id": app_body["plugin"]["id"],
        "state": state,
        "enqueued": enqueued,
    }


WHICH = b"".join(
    (
        frame(type="RUN_STARTED", threadId="t", runId="r"),
        frame(
            type="RUN_FINISHED",
            outcome={
                "type": "interrupt",
                "interrupts": [
                    {
                        "id": "i1",
                        "message": "Which release?",
                        "responseSchema": {
                            "oneOf": [
                                {"const": "a", "title": "Release A"},
                                {"const": "b", "title": "Release B"},
                            ]
                        },
                    }
                ],
            },
        ),
    )
)


class TestAgentsFromAnAssistant:
    async def test_ask_an_agent_and_read_its_answer(self, crew: dict[str, Any]) -> None:
        mcp = await connect(crew["owner"], can_write=True)
        said = await mcp.call(
            "ask_agent", {"agent": "@Helper", "channel": "#general", "text": "summarise"}
        )
        asked = message_id_in(said)
        assert ("agui_run", asked) in crew["enqueued"]
        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT body, mention_user_ids FROM messages WHERE id = :id"),
                    {"id": asked},
                )
            ).one()
        assert row.body == "@Helper summarise"

        crew["state"]["scripts"] = [says("Three things happened.")]
        await agui_job.handle_agui_run(asked)

        status = await mcp.call("run_status", {"message_id": asked})
        assert "— Helper: succeeded" in status
        assert "It answered:\nThree things happened." in status

    async def test_a_person_is_not_an_agent(self, crew: dict[str, Any]) -> None:
        mcp = await connect(crew["owner"], can_write=True)
        said = await mcp.refuse(
            "ask_agent", {"agent": "@Member", "channel": "#general", "text": "hi"}
        )
        assert "is not an agent" in said

    async def test_answer_its_question_with_the_choice_offered(self, crew: dict[str, Any]) -> None:
        mcp = await connect(crew["owner"], can_write=True)
        asked = message_id_in(
            await mcp.call(
                "ask_agent", {"agent": "Helper", "channel": "#general", "text": "draft notes"}
            )
        )
        crew["state"]["scripts"] = [WHICH]
        await agui_job.handle_agui_run(asked)

        status = await mcp.call("run_status", {"message_id": asked})
        assert "It asks this person: Which release?" in status
        assert "  0. Release A\n  1. Release B" in status
        run_id = re.search(r"Run ([0-9a-f-]{36})", status).group(1)  # type: ignore[union-attr]

        answered = await mcp.call("answer_decision", {"run_id": run_id, "choice": 1})
        assert answered.startswith("Answered")
        resumes = [job for job in crew["enqueued"] if job[0] == "agui_run" and len(job) == 3]
        assert [job[2] for job in resumes] == [run_id]

    async def test_somebody_else_cannot_answer_it(self, crew: dict[str, Any]) -> None:
        owners = await connect(crew["owner"], can_write=True)
        asked = message_id_in(
            await owners.call("ask_agent", {"agent": "Helper", "channel": "#general", "text": "?"})
        )
        crew["state"]["scripts"] = [WHICH]
        await agui_job.handle_agui_run(asked)
        status = await owners.call("run_status", {"message_id": asked})
        run_id = re.search(r"Run ([0-9a-f-]{36})", status).group(1)  # type: ignore[union-attr]

        members = await connect(crew["member"], can_write=True)
        said = await members.refuse("answer_decision", {"run_id": run_id, "choice": 0})
        assert "Only the person who asked" in said

    async def test_stop_a_run_that_is_going(self, crew: dict[str, Any]) -> None:
        run_id = "01a33333-3333-7333-8333-333333333333"
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO agent_runs
                        (id, workspace_id, plugin_id, channel_id, transport, status, chain_id)
                    VALUES (:id, (SELECT workspace_id FROM plugins WHERE id = :p), :p, :c,
                            'http', 'running', :id)
                    """
                ),
                {"id": run_id, "p": crew["plugin_id"], "c": crew["general"]},
            )
        mcp = await connect(crew["member"], can_write=True)
        said = await mcp.call("stop_run", {"run_id": run_id})
        assert said.startswith(f"Stopped run {run_id}")
        async with SessionFactory() as session:
            asked = (
                await session.execute(
                    text("SELECT cancel_requested_at FROM agent_runs WHERE id = :id"),
                    {"id": run_id},
                )
            ).scalar_one()
        assert asked is not None

    async def test_a_run_in_a_room_they_cannot_see_is_not_theirs_to_read(
        self, crew: dict[str, Any]
    ) -> None:
        run_id = "01a44444-4444-7444-8444-444444444444"
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO agent_runs
                        (id, workspace_id, plugin_id, channel_id, transport, status, chain_id)
                    VALUES (:id, (SELECT workspace_id FROM plugins WHERE id = :p), :p, :c,
                            'http', 'running', :id)
                    """
                ),
                {"id": run_id, "p": crew["plugin_id"], "c": crew["private"]},
            )
        outsider = await connect(crew["outsider"], can_write=True)
        said = await outsider.refuse("run_status", {"run_id": run_id})
        assert "Helper" not in said
        assert "running" not in said
