"""Messages written now and sent later.

The happy path is the least interesting part. What matters is what the sweep does when
the world has changed between writing and sending — the author left the channel, someone
cancelled it, two workers reached for the same row — because those are the paths that end
with a message going somewhere it should not, or twice.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import text as sql

from blob_api.db.engine import SessionFactory
from blob_api.jobs.scheduled import send_scheduled

from .helpers import Client, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "member": member, "general": general}


def at(**kwargs: float) -> str:
    return (datetime.now(UTC) + timedelta(**kwargs)).isoformat().replace("+00:00", "Z")


async def schedule(team: dict, *, when: str, body: str = "later thing") -> dict:
    answer = await team["owner"].post(
        f"/api/channels/{team['general']['id']}/schedule",
        {"body": body, "sendAt": when, "clientMsgId": f"sched-{body}"},
    )
    return {"status": answer.status, "body": answer.body}


async def bodies_in_channel(team: dict) -> list[str]:
    msgs = (await team["owner"].get(f"/api/channels/{team['general']['id']}/messages")).body
    return [m["body"] for m in msgs["messages"]]


async def make_due(scheduled_id: str) -> None:
    """Reach into the row rather than waiting a minute for the clock."""
    async with SessionFactory() as session, session.begin():
        await session.execute(
            sql(
                "UPDATE scheduled_messages SET send_at = now() - interval '1 minute' WHERE id = :id"
            ),
            {"id": scheduled_id},
        )


class TestScheduling:
    async def test_a_scheduled_message_is_not_in_the_channel_yet(self, team: dict) -> None:
        made = await schedule(team, when=at(hours=2), body="not yet")

        assert made["status"] == 200, made["body"]
        assert "not yet" not in await bodies_in_channel(team)
        listed = (await team["owner"].get("/api/scheduled")).body["scheduled"]
        assert [s["body"] for s in listed] == ["not yet"]

    async def test_a_time_in_the_past_is_refused(self, team: dict) -> None:
        made = await schedule(team, when=at(hours=-1))

        assert made["status"] == 400
        assert made["body"]["error"]["code"] == "invalid_input"

    async def test_a_time_without_a_zone_is_refused(self, team: dict) -> None:
        # Without an offset there is no way to know whose nine o'clock was meant.
        answer = await team["owner"].post(
            f"/api/channels/{team['general']['id']}/schedule",
            {"body": "when?", "sendAt": "2027-01-01T09:00:00", "clientMsgId": "no-zone"},
        )

        assert answer.status == 400

    async def test_you_cannot_schedule_into_a_channel_you_are_not_in(self, team: dict) -> None:
        private = await team["owner"].post(
            "/api/channels", {"name": "owners-only", "kind": "private"}
        )
        channel_id = private.body["channel"]["id"]

        answer = await team["member"].post(
            f"/api/channels/{channel_id}/schedule",
            {"body": "sneaking in", "sendAt": at(hours=1), "clientMsgId": "sneak"},
        )

        assert answer.status in (403, 404)

    async def test_scheduled_messages_are_private_to_their_author(self, team: dict) -> None:
        await schedule(team, when=at(hours=2), body="owner's own")

        listed = (await team["member"].get("/api/scheduled")).body["scheduled"]

        assert listed == []


class TestTheSweep:
    async def test_a_due_message_is_sent(self, team: dict) -> None:
        made = await schedule(team, when=at(hours=1), body="due now")
        await make_due(made["body"]["scheduled"]["id"])

        await send_scheduled({})

        assert "due now" in await bodies_in_channel(team)
        assert (await team["owner"].get("/api/scheduled")).body["scheduled"] == []

    async def test_sweeping_twice_does_not_post_twice(self, team: dict) -> None:
        # The row carries its clientMsgId precisely so a retry after a partial failure
        # lands on the same idempotency the live send path uses.
        made = await schedule(team, when=at(hours=1), body="exactly once")
        scheduled_id = made["body"]["scheduled"]["id"]
        await make_due(scheduled_id)

        await send_scheduled({})
        await make_due(scheduled_id)  # pretend the first sweep died before marking it
        await send_scheduled({})

        assert (await bodies_in_channel(team)).count("exactly once") == 1

    async def test_a_cancelled_message_is_never_sent(self, team: dict) -> None:
        made = await schedule(team, when=at(hours=1), body="taken back")
        scheduled_id = made["body"]["scheduled"]["id"]
        assert (await team["owner"].delete(f"/api/scheduled/{scheduled_id}")).status == 200
        await make_due(scheduled_id)

        await send_scheduled({})

        assert "taken back" not in await bodies_in_channel(team)

    async def test_leaving_the_channel_stops_it(self, team: dict) -> None:
        # Checked again at send time, not trusted from scheduling time: the world moves
        # between writing a message and sending it.
        channel_id = team["general"]["id"]
        made = await team["member"].post(
            f"/api/channels/{channel_id}/schedule",
            {"body": "sent after leaving", "sendAt": at(hours=1), "clientMsgId": "left"},
        )
        assert made.status == 200, made.body
        left = await team["member"].post(f"/api/channels/{channel_id}/leave", {})
        assert left.status in (200, 204)
        await make_due(made.body["scheduled"]["id"])

        await send_scheduled({})

        assert "sent after leaving" not in await bodies_in_channel(team)

    async def test_a_message_that_could_not_be_sent_says_why(self, team: dict) -> None:
        channel_id = team["general"]["id"]
        made = await team["member"].post(
            f"/api/channels/{channel_id}/schedule",
            {"body": "doomed", "sendAt": at(hours=1), "clientMsgId": "doomed"},
        )
        await team["member"].post(f"/api/channels/{channel_id}/leave", {})
        await make_due(made.body["scheduled"]["id"])

        await send_scheduled({})

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    sql("SELECT last_error FROM scheduled_messages WHERE id = :id"),
                    {"id": made.body["scheduled"]["id"]},
                )
            ).fetchone()
        assert row is not None and row.last_error

    async def test_cancelling_someone_elses_is_not_possible(self, team: dict) -> None:
        made = await schedule(team, when=at(hours=2), body="not yours")

        answer = await team["member"].delete(f"/api/scheduled/{made['body']['scheduled']['id']}")

        assert answer.status == 404
