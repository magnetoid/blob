"""A scheduled message that comes back.

The standup reminder. `test_recurrence.py` covers the arithmetic on its own; this covers
the part that only breaks once a row, a sweep and a send path are involved.

Two of these guard failures that would have been invisible in production. A recurring row
reusing its `client_msg_id` sends once and is then deduplicated into that same message
forever — the schedule appears to fire and nothing ever arrives. And a worker that was
down for a week would, on waking, owe Monday seven days of reminders at once.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import text as sql

from blob_api.db.engine import SessionFactory
from blob_api.jobs.scheduled import send_scheduled

from .helpers import Client, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "general": general}


def at(**kwargs: float) -> str:
    return (datetime.now(UTC) + timedelta(**kwargs)).isoformat().replace("+00:00", "Z")


async def schedule(
    team: dict,
    *,
    body: str,
    when: str | None = None,
    repeat: str | None = None,
    timezone: str = "UTC",
) -> dict:
    payload: dict[str, object] = {
        "body": body,
        "sendAt": when or at(hours=2),
        "clientMsgId": f"sched-{body}",
        "timezone": timezone,
    }
    if repeat is not None:
        payload["repeat"] = repeat
    answer = await team["owner"].post(f"/api/channels/{team['general']['id']}/schedule", payload)
    return {"status": answer.status, "body": answer.body}


async def bodies_in_channel(team: dict) -> list[str]:
    msgs = (await team["owner"].get(f"/api/channels/{team['general']['id']}/messages")).body
    return [m["body"] for m in msgs["messages"]]


async def waiting(team: dict) -> list[dict]:
    return (await team["owner"].get("/api/scheduled")).body["scheduled"]


async def move_send_at(scheduled_id: str, *, ago: timedelta) -> None:
    """Reach into the row rather than waiting for the clock to come round."""
    async with SessionFactory() as session, session.begin():
        await session.execute(
            sql("UPDATE scheduled_messages SET send_at = :when WHERE id = :id"),
            {"id": scheduled_id, "when": datetime.now(UTC) - ago},
        )


class TestARuleIsAccepted:
    async def test_a_known_rule_is_kept_and_read_back(self, team: dict) -> None:
        made = await schedule(team, body="standup", repeat="weekdays")

        assert made["status"] == 200, made["body"]
        assert made["body"]["scheduled"]["repeat"] == "weekdays"
        assert [s["repeat"] for s in await waiting(team)] == ["weekdays"]

    async def test_no_rule_at_all_is_still_the_ordinary_case(self, team: dict) -> None:
        made = await schedule(team, body="once")

        assert made["status"] == 200
        assert made["body"]["scheduled"]["repeat"] is None
        assert made["body"]["scheduled"]["lastSentAt"] is None

    async def test_a_rule_nobody_defined_is_refused(self, team: dict) -> None:
        made = await schedule(team, body="hourly thing", repeat="hourly")

        assert made["status"] == 400, made["body"]
        assert made["body"]["error"]["code"] == "invalid_input"
        # Refused, not stored — a row the sweep picks up every minute and cannot act on
        # is worse than a rejected request.
        assert await waiting(team) == []


class TestItComesBack:
    async def test_it_sends_and_stays_on_the_list(self, team: dict) -> None:
        made = await schedule(team, body="standup", repeat="daily")
        row = made["body"]["scheduled"]
        await move_send_at(row["id"], ago=timedelta(minutes=1))

        await send_scheduled({})

        assert "standup" in await bodies_in_channel(team)
        still = await waiting(team)
        assert [s["id"] for s in still] == [row["id"]]
        assert still[0]["lastSentAt"] is not None
        # The next occurrence, not the one that just went out.
        assert datetime.fromisoformat(still[0]["sendAt"]) > datetime.now(UTC)

    async def test_a_one_off_is_gone_once_it_has_gone(self, team: dict) -> None:
        made = await schedule(team, body="once only")
        await move_send_at(made["body"]["scheduled"]["id"], ago=timedelta(minutes=1))

        await send_scheduled({})

        assert "once only" in await bodies_in_channel(team)
        assert await waiting(team) == []

    async def test_the_second_occurrence_is_a_second_message(self, team: dict) -> None:
        # The one that fails if `client_msg_id` is not rotated: the send path is
        # idempotent on it, so occurrence two would resolve to the row occurrence one
        # created and the channel would never see it.
        made = await schedule(team, body="standup", repeat="daily")
        row_id = made["body"]["scheduled"]["id"]

        await move_send_at(row_id, ago=timedelta(minutes=1))
        await send_scheduled({})
        await move_send_at(row_id, ago=timedelta(minutes=1))
        await send_scheduled({})

        assert (await bodies_in_channel(team)).count("standup") == 2

    async def test_stopping_it_stops_it(self, team: dict) -> None:
        made = await schedule(team, body="standup", repeat="daily")
        row_id = made["body"]["scheduled"]["id"]
        await move_send_at(row_id, ago=timedelta(minutes=1))
        await send_scheduled({})

        gone = await team["owner"].delete(f"/api/scheduled/{row_id}")

        assert gone.status == 200
        await move_send_at(row_id, ago=timedelta(minutes=1))
        await send_scheduled({})
        assert (await bodies_in_channel(team)).count("standup") == 1


class TestTimeThatPassed:
    async def test_missed_occurrences_are_skipped_rather_than_sent(self, team: dict) -> None:
        # A worker down over a long weekend must not wake up owing three standups at
        # once. One send, and the row lands on the next slot that is actually ahead.
        made = await schedule(team, body="standup", repeat="daily")
        row_id = made["body"]["scheduled"]["id"]
        await move_send_at(row_id, ago=timedelta(days=6))

        await send_scheduled({})

        assert (await bodies_in_channel(team)).count("standup") == 1
        still = await waiting(team)
        assert datetime.fromisoformat(still[0]["sendAt"]) > datetime.now(UTC)

    async def test_and_only_needs_one_sweep_to_catch_up(self, team: dict) -> None:
        # If catching up took one sweep per missed day, a row a year behind would be due
        # every minute for a year. The next occurrence has to be ahead after one pass.
        made = await schedule(team, body="standup", repeat="weekdays")
        row_id = made["body"]["scheduled"]["id"]
        await move_send_at(row_id, ago=timedelta(days=200))

        await send_scheduled({})
        await send_scheduled({})

        assert (await bodies_in_channel(team)).count("standup") == 1


class TestTheWallClock:
    async def test_the_authors_zone_is_kept_with_the_row(self, team: dict) -> None:
        made = await schedule(team, body="standup", repeat="daily", timezone="Europe/Belgrade")

        async with SessionFactory() as session:
            stored = (
                await session.execute(
                    sql("SELECT timezone FROM scheduled_messages WHERE id = :id"),
                    {"id": made["body"]["scheduled"]["id"]},
                )
            ).scalar_one()

        # Kept because the next occurrence is rebuilt from a wall clock at every send.
        # Computed once in UTC it would drift by an hour twice a year, silently.
        assert stored == "Europe/Belgrade"

    async def test_an_unknown_zone_does_not_stop_the_send(self, team: dict) -> None:
        made = await schedule(team, body="standup", repeat="daily", timezone="Mars/Olympus")
        await move_send_at(made["body"]["scheduled"]["id"], ago=timedelta(minutes=1))

        await send_scheduled({})

        # Falling back beats raising inside a job that is sending everybody else's
        # messages too.
        assert "standup" in await bodies_in_channel(team)
        assert len(await waiting(team)) == 1


class TestAChannelThatWentReadOnly:
    async def test_nothing_can_be_scheduled_into_an_archived_one(self, team: dict) -> None:
        # `require_writable` is the only archived guard there is, and the schedule route
        # was not asking for it — so a message could be put thirty seconds ahead into a
        # channel the send route had just refused.
        await team["owner"].post(f"/api/channels/{team['general']['id']}/archive")

        made = await schedule(team, body="after the fact")

        assert made["status"] == 403, made["body"]

    async def test_and_a_repeating_one_stops_rather_than_posting_for_ever(self, team: dict) -> None:
        made = await schedule(team, body="standup", repeat="daily")
        row_id = made["body"]["scheduled"]["id"]
        await team["owner"].post(f"/api/channels/{team['general']['id']}/archive")
        await move_send_at(row_id, ago=timedelta(minutes=1))

        await send_scheduled({})

        assert "standup" not in await bodies_in_channel(team)

    async def test_and_the_author_is_told_why(self, team: dict) -> None:
        # `last_error` was written to a row nothing selected: the message simply never
        # arrived and the Scheduled list was empty.
        made = await schedule(team, body="standup", repeat="daily")
        row_id = made["body"]["scheduled"]["id"]
        await team["owner"].post(f"/api/channels/{team['general']['id']}/archive")
        await move_send_at(row_id, ago=timedelta(minutes=1))
        await send_scheduled({})

        listed = await waiting(team)

        assert [s["id"] for s in listed] == [row_id]
        assert listed[0]["lastError"] is not None

    async def test_and_can_dismiss_the_notice(self, team: dict) -> None:
        made = await schedule(team, body="standup")
        row_id = made["body"]["scheduled"]["id"]
        await team["owner"].post(f"/api/channels/{team['general']['id']}/archive")
        await move_send_at(row_id, ago=timedelta(minutes=1))
        await send_scheduled({})

        gone = await team["owner"].delete(f"/api/scheduled/{row_id}")

        # Same button, same call: taking one back and clearing a failure are one gesture.
        assert gone.status == 200, gone.body
        assert await waiting(team) == []
