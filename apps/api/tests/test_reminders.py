"""A reminder is a scheduled message to yourself.

That is the whole design, and these hold it to it: the row goes in the same table, the same
sweep sends it, the same recurrence engine repeats it, and the same Scheduled view lists it
with the same Cancel button. Nothing here is a second delivery path, which is what a
`reminders` table with its own job would have been.

Where it lands is the conversation you have with yourself — a DM whose only member is you.
`when.py` is tested on its own; what is worth pinning here is the row that comes out.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import text as sql

from blob_api.db.engine import SessionFactory, transaction
from blob_api.services import reminders

from .helpers import Client, sign_up


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Reminder Owner")


async def set_zone(user_id: str, zone: str) -> None:
    async with SessionFactory() as session, session.begin():
        await session.execute(
            sql("UPDATE users SET timezone = :zone WHERE id = :id"),
            {"zone": zone, "id": user_id},
        )


async def make(owner: Client, args: str, *, now: datetime | None = None) -> tuple[str, object]:
    workspace_id = (await owner.get("/api/bootstrap")).body["workspace"]["id"]
    async with transaction() as (session, _after):
        return await reminders.create(
            session,
            workspace_id=workspace_id,
            user_id=owner.user_id or "",
            args=args,
            now=now,
        )


async def scheduled_rows(user_id: str) -> list[dict]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                sql(
                    "SELECT body, send_at, repeat, timezone, channel_id FROM scheduled_messages"
                    " WHERE author_id = :id ORDER BY send_at"
                ),
                {"id": user_id},
            )
        ).fetchall()
    return [dict(r._mapping) for r in rows]


class TestSettingOne:
    async def test_stores_the_words_and_the_moment(self, owner: Client) -> None:
        said, _channel = await make(owner, "me to water the plants in 2 hours")

        rows = await scheduled_rows(owner.user_id or "")
        assert [r["body"] for r in rows] == ["water the plants"]
        assert rows[0]["repeat"] is None
        assert "Reminder set" in said

    async def test_it_goes_to_the_conversation_with_yourself(self, owner: Client) -> None:
        await make(owner, "me to breathe in 1 hour")

        rows = await scheduled_rows(owner.user_id or "")
        async with SessionFactory() as session:
            members = (
                await session.execute(
                    sql("SELECT user_id FROM channel_members WHERE channel_id = :c"),
                    {"c": rows[0]["channel_id"]},
                )
            ).fetchall()
            kind = (
                await session.execute(
                    sql("SELECT kind FROM channels WHERE id = :c"), {"c": rows[0]["channel_id"]}
                )
            ).scalar_one()

        assert kind == "dm"
        assert [str(m.user_id) for m in members] == [owner.user_id]

    async def test_the_dm_comes_back_only_the_first_time(self, owner: Client) -> None:
        # The client has to be told about a conversation it has never seen, and only then.
        _first_said, first = await make(owner, "me to a in 1 hour")
        _second_said, second = await make(owner, "me to b in 2 hours")

        assert first is not None
        assert second is None

    async def test_and_both_land_in_the_same_one(self, owner: Client) -> None:
        await make(owner, "me to a in 1 hour")
        await make(owner, "me to b in 2 hours")

        rows = await scheduled_rows(owner.user_id or "")
        assert len({r["channel_id"] for r in rows}) == 1

    async def test_two_identical_reminders_are_two_reminders(self, owner: Client) -> None:
        # The send path deduplicates on `client_msg_id`; deriving it from the text would
        # make the second one silently vanish.
        await make(owner, "me to stretch in 1 hour")
        await make(owner, "me to stretch in 1 hour")

        assert len(await scheduled_rows(owner.user_id or "")) == 2


class TestARepeatingOne:
    async def test_carries_the_rule(self, owner: Client) -> None:
        said, _ = await make(owner, "me to post standup every weekday at 9am")

        rows = await scheduled_rows(owner.user_id or "")
        assert rows[0]["repeat"] == "weekdays"
        assert rows[0]["body"] == "post standup"
        assert "every weekday" in said.lower()

    async def test_its_first_slot_is_a_weekday(self, owner: Client) -> None:
        # Set on a Friday afternoon: the first standup is Monday, not Saturday.
        friday = datetime(2026, 9, 4, 12, 30, tzinfo=UTC)

        await make(owner, "me to post standup every weekday at 9am", now=friday)

        rows = await scheduled_rows(owner.user_id or "")
        assert rows[0]["send_at"].weekday() == 0


class TestTheirOwnClock:
    async def test_nine_means_nine_where_they_are(self, owner: Client) -> None:
        await set_zone(owner.user_id or "", "Pacific/Auckland")

        await make(owner, "me to wake up at 9")

        rows = await scheduled_rows(owner.user_id or "")
        assert rows[0]["timezone"] == "Pacific/Auckland"
        # Stored as an instant; nine in Auckland is not nine in UTC.
        from zoneinfo import ZoneInfo

        assert rows[0]["send_at"].astimezone(ZoneInfo("Pacific/Auckland")).hour == 9

    async def test_the_zone_is_kept_for_the_recurrence(self, owner: Client) -> None:
        # It has to be re-read at every occurrence, or "every weekday at nine" drifts by
        # an hour twice a year. See `services/recurrence`.
        await set_zone(owner.user_id or "", "Europe/Belgrade")

        await make(owner, "me to post standup every day at 9am")

        rows = await scheduled_rows(owner.user_id or "")
        assert rows[0]["timezone"] == "Europe/Belgrade"


class TestWhenItCannotTell:
    async def test_says_how_rather_than_guessing(self, owner: Client) -> None:
        said, channel = await make(owner, "me to do the thing")

        # A reminder at a time nobody chose is worse than none, and the refusal is the
        # only chance to say what the grammar actually is.
        assert "/remind me" in said
        assert channel is None
        assert await scheduled_rows(owner.user_id or "") == []

    async def test_a_time_with_nothing_to_say(self, owner: Client) -> None:
        said, _ = await make(owner, "me at 17:00")

        assert "/remind me" in said
        assert await scheduled_rows(owner.user_id or "") == []

    async def test_and_nothing_at_all(self, owner: Client) -> None:
        said, _ = await make(owner, "")

        assert "/remind me" in said


class TestItIsAnOrdinaryScheduledMessage:
    async def test_it_shows_up_in_the_scheduled_list(self, owner: Client) -> None:
        await make(owner, "me to water the plants in 3 hours")

        listed = (await owner.get("/api/scheduled")).body["scheduled"]

        assert [s["body"] for s in listed] == ["water the plants"]

    async def test_and_can_be_cancelled_from_it(self, owner: Client) -> None:
        await make(owner, "me to water the plants in 3 hours")
        listed = (await owner.get("/api/scheduled")).body["scheduled"]

        gone = await owner.delete(f"/api/scheduled/{listed[0]['id']}")

        assert gone.status == 200
        assert (await owner.get("/api/scheduled")).body["scheduled"] == []

    async def test_the_sweep_sends_it(self, owner: Client) -> None:
        from blob_api.jobs.scheduled import send_scheduled

        await make(owner, "me to water the plants in 1 hour")
        rows = await scheduled_rows(owner.user_id or "")
        async with SessionFactory() as session, session.begin():
            await session.execute(
                sql("UPDATE scheduled_messages SET send_at = :when WHERE author_id = :id"),
                {"when": datetime.now(UTC) - timedelta(minutes=1), "id": owner.user_id},
            )

        await send_scheduled({})

        messages = (await owner.get(f"/api/channels/{rows[0]['channel_id']}/messages")).body[
            "messages"
        ]
        assert [m["body"] for m in messages] == ["water the plants"]


class TestTheCommand:
    async def test_sets_one_and_says_so(self, owner: Client) -> None:
        from .helpers import client_msg_id

        channels = (await owner.get("/api/channels")).body["channels"]
        general = next(c for c in channels if c["name"] == "general")

        answer = await owner.post(
            "/api/commands",
            {
                "channelId": general["id"],
                "text": "/remind me to water the plants in 2 hours",
                "clientMsgId": client_msg_id(),
            },
        )

        assert answer.status == 200, answer.body
        assert "Reminder set" in answer.body["ephemeral"]
        # Nothing is posted into the channel it was typed in: a reminder is a private note.
        assert answer.body["message"] is None
        assert [s["body"] for s in (await owner.get("/api/scheduled")).body["scheduled"]] == [
            "water the plants"
        ]

    async def test_it_does_not_take_you_anywhere(self, owner: Client) -> None:
        from .helpers import client_msg_id

        channels = (await owner.get("/api/channels")).body["channels"]
        general = next(c for c in channels if c["name"] == "general")

        answer = await owner.post(
            "/api/commands",
            {
                "channelId": general["id"],
                "text": "/remind me to breathe in 1 hour",
                "clientMsgId": client_msg_id(),
            },
        )

        # The conversation with yourself is created and the sidebar is told over the
        # socket, but `channel` is what makes the client navigate — and /remind is
        # something you say in passing.
        assert answer.body["channel"] is None

    async def test_it_is_listed_in_help(self, owner: Client) -> None:
        from .helpers import client_msg_id

        channels = (await owner.get("/api/channels")).body["channels"]
        general = next(c for c in channels if c["name"] == "general")

        answer = await owner.post(
            "/api/commands",
            {"channelId": general["id"], "text": "/help", "clientMsgId": client_msg_id()},
        )

        assert "/remind" in answer.body["ephemeral"]
