"""A conversation becomes a place to build something.

Starting work from a message spins a private channel for that assignment, quotes where it
came from, brings the named agents (on the starter's authority), and links forward from
the source thread. Agents publish artifacts into it over AG-UI and the bot API; people by
hand; finishing archives the channel. These pin all of that, and the two refusals that
matter: an agent only its owner may command cannot be brought into somebody else's work,
and somebody outside the channel gets 404, not 403.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import streams

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of
from .test_agui import (
    ANSWER,
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
    install,
    join_channel,
    messages_in,
)

PLANNER = {"slug": "planner", "name": "Planner", "aguiUrl": "https://apps.example.com/planner"}

PUBLISHES_A_DIFF = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(
        type="CUSTOM",
        name="blob.artifact",
        value={
            "kind": "diff",
            "title": "Add the rate limit",
            "body": "--- a/x.py\n+++ b/x.py\n@@ -1 +1,2 @@\n x = 1\n+limit = 30\n",
        },
    ),
    frame(
        type="CUSTOM",
        name="blob.artifact",
        value={"kind": "html", "title": "Preview", "body": "<h1>hello</h1>"},
    ),
    *ANSWER[1:],
)


@pytest_asyncio.fixture
async def team(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict:
    owner = await sign_up(client, "Owner")
    marko = await invite_and_sign_up(owner, "Marko")
    ana = await invite_and_sign_up(owner, "Ana")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    helper = await install(owner)
    await join_channel(owner, helper, general)

    slot: dict[str, Any] = {"transport": None}
    real = httpx.AsyncClient

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        theirs = kwargs.pop("transport", None)
        return real(**kwargs, transport=slot["transport"] or theirs)

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)

    enqueued: list[tuple[Any, ...]] = []

    async def _nothing() -> None:
        pass

    def record(job: str, *args: Any) -> Any:
        enqueued.append((job, *args))
        return _nothing()

    from blob_api.lib import queue as queue_module

    monkeypatch.setattr(agui_job, "enqueue", record)
    monkeypatch.setattr(queue_module, "enqueue", record)

    root = await send_message(owner, general, "We need rate limiting on the API, who takes it?")
    return {
        "owner": owner,
        "marko": marko,
        "ana": ana,
        "general": general,
        "helper": helper,
        "root_id": str(root.body["message"]["id"]),
        "slot": slot,
        "enqueued": enqueued,
        "workspace_id": await workspace_id_of(owner),
    }


def speak(team: dict, *chunks: bytes) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)

        async def body() -> Any:
            for chunk in chunks:
                yield chunk

        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body())

    team["slot"]["transport"] = httpx.MockTransport(handler)
    return seen


async def start(team: dict, who: Client | None = None, **overrides: Any) -> dict:
    who = who or team["owner"]
    answer = await who.post(
        "/api/work",
        {
            "rootMessageId": team["root_id"],
            "title": "Rate limiting for the API",
            "agentPluginIds": [team["helper"]["plugin"]["id"]],
            **overrides,
        },
    )
    assert answer.status == 201, answer.body
    return dict(answer.body)


async def run_kickoff(team: dict) -> None:
    """Drive the run the kickoff message asked for, as the worker would."""
    roots = [e for e in team["enqueued"] if e[0] == "agui_run" and len(e) == 2]
    assert len(roots) == 1, team["enqueued"]
    await agui_job.handle_agui_run(roots[0][1])


class TestStarting:
    async def test_it_spins_a_private_channel_with_the_starter_and_the_agents(
        self, team: dict
    ) -> None:
        started = await start(team)

        work, channel = started["work"], started["channel"]
        assert work["status"] == "open"
        assert work["rootMessageId"] == team["root_id"]
        assert channel["kind"] == "private"
        assert channel["name"] == "work-rate-limiting-for-the-api"
        assert channel["topic"] == "Rate limiting for the API"
        members = (await team["owner"].get(f"/api/channels/{channel['id']}/members")).body
        ids = set(members["userIds"])
        assert team["owner"].user_id in ids
        assert team["helper"]["plugin"]["botUserId"] in ids

    async def test_the_channel_says_where_it_came_from_and_the_source_links_forward(
        self, team: dict
    ) -> None:
        started = await start(team)

        bodies = [m["body"] for m in await messages_in(started["channel"]["id"])]
        assert bodies[0].startswith("Started from #general:")
        assert "> We need rate limiting on the API" in bodies[0]
        assert f"/m/{team['root_id']}" in bodies[0]
        # The kickoff mentions the agent — the chain roots on the starter's authority.
        assert bodies[1] == "@Helper Rate limiting for the API"
        source = [m["body"] for m in await messages_in(team["general"])]
        assert any(f"/c/{started['channel']['id']}" in b for b in source)

    async def test_the_kickoff_starts_the_agent_on_the_starters_authority(self, team: dict) -> None:
        seen = speak(team, *ANSWER)
        await start(team)

        await run_kickoff(team)

        [request] = seen
        context = {c["description"]: c["value"] for c in json.loads(request.content)["context"]}
        assert context["asked_by"] == "Owner"
        assert context["channel"] == "work-rate-limiting-for-the-api"

    async def test_the_root_authors_are_brought_along(self, team: dict) -> None:
        # Marko wrote the message; Owner starts work from it. Marko is in the room.
        marko_msg = await send_message(team["marko"], team["general"], "I can take it")
        started = await start(team, rootMessageId=marko_msg.body["message"]["id"])
        members = (
            await team["owner"].get(f"/api/channels/{started['channel']['id']}/members")
        ).body
        assert team["marko"].user_id in set(members["userIds"])

    async def test_a_second_assignment_with_the_same_title_gets_its_own_channel(
        self, team: dict
    ) -> None:
        first = await start(team)
        second = await start(team)
        assert first["channel"]["name"] == "work-rate-limiting-for-the-api"
        assert second["channel"]["name"] == "work-rate-limiting-for-the-api-2"

    async def test_you_cannot_start_from_a_message_you_cannot_see(self, team: dict) -> None:
        made = await team["owner"].post("/api/channels", {"name": "owners", "kind": "private"})
        secret = await send_message(team["owner"], made.body["channel"]["id"], "hush")

        refused = await team["ana"].post(
            "/api/work",
            {"rootMessageId": secret.body["message"]["id"], "title": "Peek", "agentPluginIds": []},
        )
        assert refused.status == 404

    async def test_somebody_elses_agent_cannot_be_brought(self, team: dict) -> None:
        planner = await install(team["owner"], **PLANNER)
        gave = await team["owner"].put(
            f"/api/admin/plugins/{planner['plugin']['id']}/owner", {"userId": team["marko"].user_id}
        )
        assert gave.status == 200, gave.body

        refused = await team["ana"].post(
            "/api/work",
            {
                "rootMessageId": team["root_id"],
                "title": "Borrowing",
                "agentPluginIds": [planner["plugin"]["id"]],
            },
        )
        assert refused.status == 403, refused.body
        assert "not yours to bring" in refused.body["error"]["message"]

    async def test_but_its_owner_can(self, team: dict) -> None:
        planner = await install(team["owner"], **PLANNER)
        await team["owner"].put(
            f"/api/admin/plugins/{planner['plugin']['id']}/owner", {"userId": team["marko"].user_id}
        )
        started = await start(team, team["marko"], agentPluginIds=[planner["plugin"]["id"]])
        assert started["work"]["status"] == "open"


class TestArtifacts:
    async def test_an_agent_publishes_over_agui(self, team: dict) -> None:
        speak(team, *PUBLISHES_A_DIFF)
        started = await start(team)

        await run_kickoff(team)

        detail = (await team["owner"].get(f"/api/work/{started['work']['id']}")).body
        kinds = [(a["kind"], a["title"]) for a in detail["artifacts"]]
        assert kinds == [("diff", "Add the rate limit"), ("html", "Preview")]
        assert detail["artifacts"][0]["authorUserId"] == team["helper"]["plugin"]["botUserId"]
        assert detail["artifacts"][0]["runId"] is not None
        assert detail["work"]["artifactCount"] == 2
        # The answer itself still landed as a message.
        assert "Standup is at nine." in [
            m["body"] for m in await messages_in(started["channel"]["id"])
        ]

    async def test_outside_a_work_channel_the_event_is_ignored(self, team: dict) -> None:
        speak(team, *PUBLISHES_A_DIFF)
        sent = await send_message(team["owner"], team["general"], "@Helper anything?")
        await agui_job.handle_agui_run(str(sent.body["message"]["id"]))

        async with SessionFactory() as session:
            count = (
                await session.execute(text("SELECT count(*) FROM work_artifacts"))
            ).scalar_one()
        assert count == 0

    async def test_a_person_publishes_by_hand(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        answer = await team["owner"].post(
            f"/api/work/{started['work']['id']}/artifacts",
            {"kind": "markdown", "title": "Notes", "body": "# Plan\n\n1. limit\n2. test"},
        )
        assert answer.status == 201, answer.body
        assert answer.body["artifact"]["kind"] == "markdown"

    async def test_an_app_publishes_through_the_bot_api(self, team: dict) -> None:
        # Brought in at the start, so its bot is already a member: a bot cannot join a
        # private channel by itself, and a work channel is private.
        started = await start(team)
        app_client = team["owner"].fork()
        app_client._http.headers["authorization"] = f"Bearer {team['helper']['botToken']}"
        app_client._http.cookies.clear()

        answer = await app_client.post(
            "/api/v1/work.publishArtifact",
            {
                "channel": started["channel"]["id"],
                "kind": "diff",
                "title": "From the API",
                "body": "--- a\n+++ b\n@@\n+x\n",
            },
        )
        assert answer.status == 201, answer.body

    async def test_the_kind_and_size_are_checked(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        bad_kind = await team["owner"].post(
            f"/api/work/{started['work']['id']}/artifacts",
            {"kind": "exe", "title": "x", "body": "y"},
        )
        assert bad_kind.status == 400
        too_big = await team["owner"].post(
            f"/api/work/{started['work']['id']}/artifacts",
            {"kind": "markdown", "title": "x", "body": "y" * 200_001},
        )
        assert too_big.status == 400

    async def test_somebody_outside_the_channel_gets_404(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        assert (await team["ana"].get(f"/api/work/{started['work']['id']}")).status == 404
        assert (
            await team["ana"].post(
                f"/api/work/{started['work']['id']}/artifacts",
                {"kind": "markdown", "title": "x", "body": "y"},
            )
        ).status == 404
        assert (
            await team["ana"].get(f"/api/channels/{started['channel']['id']}/work")
        ).status == 404


class TestFinishing:
    async def test_the_starter_finishes_it_and_the_channel_archives(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        done = await team["owner"].post(f"/api/work/{started['work']['id']}/done")

        assert done.status == 200, done.body
        assert done.body["work"]["status"] == "done"
        channel = (await team["owner"].get(f"/api/channels/{started['channel']['id']}")).body[
            "channel"
        ]
        assert channel["archivedAt"] is not None
        # And nothing more lands in it. The channel's own rule answers first — archived is
        # read-only — and the work's would answer 409 for a caller who got past it.
        late = await team["owner"].post(
            f"/api/work/{started['work']['id']}/artifacts",
            {"kind": "markdown", "title": "x", "body": "y"},
        )
        assert late.status in (403, 409), late.body

    async def test_a_member_who_did_not_start_it_cannot_finish_it(self, team: dict) -> None:
        marko_msg = await send_message(team["marko"], team["general"], "I can take it")
        started = await start(
            team, rootMessageId=marko_msg.body["message"]["id"], agentPluginIds=[]
        )
        # Marko is in the room (he wrote the root) but did not start the work.
        refused = await team["marko"].post(f"/api/work/{started['work']['id']}/done")
        assert refused.status == 403

    async def test_the_channel_carries_its_work_id(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        channel = (await team["owner"].get(f"/api/channels/{started['channel']['id']}")).body[
            "channel"
        ]
        assert channel["workId"] == started["work"]["id"]
        listed = (await team["owner"].get("/api/channels")).body["channels"]
        assert any(c["workId"] == started["work"]["id"] for c in listed)
        general = next(c for c in listed if c["id"] == team["general"])
        assert general["workId"] is None
