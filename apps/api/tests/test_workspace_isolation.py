"""What must not cross from one workspace to another.

Every bug of this class found in this codebase has had the same shape: a lookup that was
correct while a server held one workspace, and silent once it held several.
`assert_channel_access` found a channel by id alone. `hub.to_all` sent to every connection
on the process while its docstring said "workspace-wide". Neither failed a test, because
with one workspace both were true sentences.

These three are the rest of that family, each written against a fix:

* `add_members` inserted `unnest(:user_ids)` with two independent foreign keys and no
  workspace predicate, so a `users` row from another workspace could be planted in a
  private channel — and every message, edit and typing frame after that went to a socket
  signed into the other tenant.
* `presence.sub` took a raw list of ids off the wire.
* `/api/admin/health` counted every message and byte on the server.

The fixture is the expensive part and the point: none of this is reachable, or testable,
until a second workspace exists.
"""

from __future__ import annotations

import asyncio
import json

import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.realtime import hub

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_realtime import receive_until, socket_for


@pytest_asyncio.fixture
async def two_workspaces(client: Client) -> dict:
    """One person, two workspaces, and a user id belonging to each.

    A person is a separate `users` row per workspace, so the founder's id in the second
    workspace is a perfectly real id that nothing in the first should accept.
    """
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")

    here = (await owner.get("/api/bootstrap")).body["workspace"]["id"]
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")

    created = await owner.post("/api/admin/instance/workspaces", {"name": "Second"})
    assert created.status in (200, 201), created.body
    there = created.body["id"]

    assert (await owner.post(f"/api/workspaces/{there}/switch")).status == 200
    boot_there = (await owner.get("/api/bootstrap")).body
    foreign_user_id = boot_there["user"]["id"]
    foreign_channels = (await owner.get("/api/channels")).body["channels"]
    foreign_general = next(c for c in foreign_channels if c["name"] == "general")
    assert (await owner.post(f"/api/workspaces/{here}/switch")).status == 200

    return {
        "owner": owner,
        "member": member,
        "here": here,
        "there": there,
        "general": general,
        "foreign_general": foreign_general,
        "foreign_user_id": foreign_user_id,
    }


async def frames_until(ws: object, kind: str, timeout: float = 3.0) -> list[dict]:
    """Every frame up to and including one of `kind`.

    `receive_until` *discards* what it passes over, which quietly defeats any assertion
    about a frame that arrives before the one being waited for — the reader loop is
    sequential, so a presence frame answering a `presence.sub` always precedes the pong
    that proves the frame was handled. Collecting is the only way to assert absence.
    """

    async def _read() -> list[dict]:
        seen: list[dict] = []
        while True:
            frame = json.loads(await ws.receive_text())  # type: ignore[attr-defined]
            seen.append(frame)
            if frame.get("t") == kind:
                return seen

    return await asyncio.wait_for(_read(), timeout=timeout)


async def members_of(channel_id: str) -> set[str]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT user_id FROM channel_members WHERE channel_id = :id"),
                {"id": channel_id},
            )
        ).fetchall()
    return {str(row.user_id) for row in rows}


class TestChannelMembership:
    async def test_a_person_from_another_workspace_cannot_be_added(
        self, two_workspaces: dict
    ) -> None:
        owner = two_workspaces["owner"]
        channel_id = two_workspaces["general"]["id"]
        foreign = two_workspaces["foreign_user_id"]

        response = await owner.post(f"/api/channels/{channel_id}/members", {"userIds": [foreign]})
        # 404 and the words `open_dm` already used: whether that account exists somewhere
        # else on this server is not the caller's business.
        assert response.status == 404, response.body
        assert foreign not in await members_of(channel_id)

    async def test_the_refusal_is_all_or_nothing(self, two_workspaces: dict) -> None:
        owner = two_workspaces["owner"]
        member = two_workspaces["member"]
        channel = (await owner.post("/api/channels", {"name": "planning", "kind": "private"})).body[
            "channel"
        ]

        response = await owner.post(
            f"/api/channels/{channel['id']}/members",
            {"userIds": [member.user_id, two_workspaces["foreign_user_id"]]},
        )
        assert response.status == 404
        # Neither goes in. A partial success would leave the caller believing both did.
        assert await members_of(channel["id"]) == {owner.user_id}

    async def test_a_foreign_id_cannot_ride_in_on_channel_creation(
        self, two_workspaces: dict
    ) -> None:
        # The second way into `add_members`, and the one an attacker reaches first
        # because it needs no existing channel.
        response = await two_workspaces["owner"].post(
            "/api/channels",
            {
                "name": "secret-plans",
                "kind": "private",
                "memberIds": [two_workspaces["foreign_user_id"]],
            },
        )
        assert response.status == 404, response.body

    async def test_somebody_in_this_workspace_still_goes_in(self, two_workspaces: dict) -> None:
        # The guard has to refuse the foreign id without breaking the ordinary case.
        owner = two_workspaces["owner"]
        channel_id = two_workspaces["general"]["id"]
        response = await owner.post(
            f"/api/channels/{channel_id}/members", {"userIds": [two_workspaces["member"].user_id]}
        )
        assert response.status == 200, response.body
        assert two_workspaces["member"].user_id in await members_of(channel_id)


class TestPresence:
    async def test_a_foreign_id_is_never_watched(self, two_workspaces: dict) -> None:
        owner = two_workspaces["owner"]
        foreign = two_workspaces["foreign_user_id"]
        mine = two_workspaces["member"].user_id

        async with socket_for(owner) as ws:
            await receive_until(ws, "hello")
            await ws.send_text(json.dumps({"t": "presence.sub", "userIds": [foreign, mine]}))
            # A ping behind it: the reader loop is sequential, so a pong proves the
            # subscribe frame has already been handled. Waiting on absence directly
            # would only prove the test was impatient.
            await ws.send_text(json.dumps({"t": "ping"}))
            await receive_until(ws, "pong")

            # Ids are not secret — they ride in message payloads and outlive being
            # removed from a workspace — so this was minute-by-minute attendance
            # telemetry on named people in another tenant.
            assert foreign not in hub._by_presence_sub
            assert mine in hub._by_presence_sub

    async def test_no_state_comes_back_for_one(self, two_workspaces: dict) -> None:
        owner = two_workspaces["owner"]
        foreign = two_workspaces["foreign_user_id"]

        async with socket_for(owner) as ws:
            await receive_until(ws, "hello")
            await ws.send_text(json.dumps({"t": "presence.sub", "userIds": [foreign]}))
            # A ping behind it, and every frame collected: the pong proves the subscribe
            # was handled, and the collection is what makes absence assertable.
            await ws.send_text(json.dumps({"t": "ping"}))
            seen = await frames_until(ws, "pong")

        # `get_presence` answers for *every* id it is given — a missing Redis key maps to
        # "offline" rather than being dropped — so without the filter this frame arrives
        # and says the id is real enough to have a state.
        assert [f for f in seen if f.get("t") == "presence"] == []
        # And no error either: refusing a specific id would confirm it names somebody.
        assert [f for f in seen if f.get("t") == "error"] == []


class TestHealth:
    async def test_the_totals_count_only_this_workspace(self, two_workspaces: dict) -> None:
        owner = two_workspaces["owner"]
        here = two_workspaces["here"]
        there = two_workspaces["there"]

        await send_message(owner, two_workspaces["general"]["id"], "one here")
        before = (await owner.get("/api/admin/health")).body["messageCount"]

        assert (await owner.post(f"/api/workspaces/{there}/switch")).status == 200
        for index in range(3):
            await send_message(owner, two_workspaces["foreign_general"]["id"], f"there {index}")
        assert (await owner.post(f"/api/workspaces/{here}/switch")).status == 200

        after = (await owner.get("/api/admin/health")).body["messageCount"]
        # Whole-server totals told an ordinary workspace admin another tenant's message
        # and upload rate, and that other tenants existed at all.
        assert after == before, f"{after} != {before}: another workspace's messages counted"


class TestSessionRevocation:
    async def test_an_admin_cannot_revoke_another_workspaces_sessions(
        self, two_workspaces: dict
    ) -> None:
        # The route's DELETE found sessions by user id alone, so an admin holding any
        # user id — and ids ride in every message payload — could sign that account out
        # of every device on the server, with the audit row landing in the *attacker's*
        # workspace where the victim would never see it.
        owner = two_workspaces["owner"]
        foreign = two_workspaces["foreign_user_id"]

        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO sessions (id, user_id, token_hash, expires_at)
                    VALUES (gen_random_uuid(), :user_id, :hash, now() + interval '1 day')
                    """
                ),
                {"user_id": foreign, "hash": "isolation-test-hash"},
            )

        response = await owner.post(f"/api/admin/users/{foreign}/revoke-sessions")
        assert response.status == 404, response.body

        async with SessionFactory() as session:
            survived = (
                await session.execute(
                    text("SELECT count(*) AS n FROM sessions WHERE user_id = :id"),
                    {"id": foreign},
                )
            ).scalar_one()
        assert survived == 1, "the foreign user's session should have survived"

    async def test_revoking_within_the_workspace_still_works(self, two_workspaces: dict) -> None:
        owner = two_workspaces["owner"]
        member = two_workspaces["member"]

        response = await owner.post(f"/api/admin/users/{member.user_id}/revoke-sessions")
        assert response.status == 200, response.body

        # The member's cookie is dead; the next request bounces.
        assert (await member.get("/api/bootstrap")).status == 401
