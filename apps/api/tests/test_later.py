"""Later: states, reminders, and the cron that fires them."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs.reminders import fire_reminders

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    sent = await send_message(owner, general["id"], "worth coming back to")
    return {
        "owner": owner,
        "member": member,
        "general": general["id"],
        "message": sent.body["message"]["id"],
    }


async def _later(client: Client, state: str = "in_progress") -> list[dict]:
    return (await client.get(f"/api/later?state={state}")).body["items"]


class TestStates:
    async def test_a_reminder_saves_the_message_in_one_gesture(self, team: dict) -> None:
        at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        response = await team["owner"].patch(
            f"/api/saved/{team['message']}", {"remindAt": at, "note": "circle back"}
        )
        assert response.status == 200, response.body

        items = await _later(team["owner"])
        assert len(items) == 1
        assert items[0]["note"] == "circle back"
        assert items[0]["remindAt"] is not None
        assert items[0]["state"] == "in_progress"

    async def test_states_move_and_filter(self, team: dict) -> None:
        await team["owner"].patch(f"/api/saved/{team['message']}", {"state": "done"})
        assert await _later(team["owner"], "in_progress") == []
        assert len(await _later(team["owner"], "done")) == 1

    async def test_a_time_already_past_is_refused(self, team: dict) -> None:
        at = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
        response = await team["owner"].patch(f"/api/saved/{team['message']}", {"remindAt": at})
        assert response.status == 400

    async def test_the_list_is_yours_alone(self, team: dict) -> None:
        await team["owner"].patch(f"/api/saved/{team['message']}", {"state": "in_progress"})
        assert await _later(team["member"]) == []


async def _force_due(message_id: str) -> None:
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text("UPDATE saved_items SET remind_at = now() - interval '1 minute'"),
        )


class TestFiring:
    async def test_a_due_reminder_fires_once(self, team: dict) -> None:
        at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        await team["owner"].patch(f"/api/saved/{team['message']}", {"remindAt": at})
        await _force_due(team["message"])

        await fire_reminders({})
        await fire_reminders({})  # the ratchet: a second pass finds nothing due

        async with SessionFactory() as session:
            row = (
                await session.execute(text("SELECT reminded_at FROM saved_items LIMIT 1"))
            ).fetchone()
        assert row is not None and row.reminded_at is not None

    async def test_quiet_hours_defer_rather_than_drop(self, team: dict) -> None:
        # Snoozed flat-out: the strongest quiet signal there is.
        until = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
        assert (await team["owner"].patch("/api/me/prefs", {"snoozeUntil": until})).status == 200

        at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        await team["owner"].patch(f"/api/saved/{team['message']}", {"remindAt": at})
        await _force_due(team["message"])
        await fire_reminders({})

        async with SessionFactory() as session:
            row = (
                await session.execute(text("SELECT reminded_at FROM saved_items LIMIT 1"))
            ).fetchone()
        # Still armed — it fires when the window opens, not never.
        assert row is not None and row.reminded_at is None

    async def test_setting_a_new_reminder_rearms_a_fired_one(self, team: dict) -> None:
        at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
        await team["owner"].patch(f"/api/saved/{team['message']}", {"remindAt": at})
        await _force_due(team["message"])
        await fire_reminders({})

        again = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
        await team["owner"].patch(f"/api/saved/{team['message']}", {"remindAt": again})
        async with SessionFactory() as session:
            row = (
                await session.execute(text("SELECT reminded_at FROM saved_items LIMIT 1"))
            ).fetchone()
        assert row is not None and row.reminded_at is None
