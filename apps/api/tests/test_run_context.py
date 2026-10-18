"""What a run is told about when and where it is happening.

Without a clock a model answers "remind me tomorrow" or "what happened this morning"
against its training date, and without the room it cannot tell two people from two
hundred. These are plain context items any agent may read or ignore — nothing here is
specific to one agent.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import agui

from .helpers import send_message
from .test_agent_tools import says
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module
from .test_task_dispatch import desk_fixture  # noqa: F401 — the fake agent and its room


class TestTheClock:
    def test_it_says_the_moment_in_utc_and_where_the_person_is(self) -> None:
        at = datetime(2026, 10, 18, 19, 45, 0, tzinfo=UTC)
        assert agui.clock(at, "Europe/Belgrade") == {
            "utc": "2026-10-18T19:45:00Z",
            "timezone": "Europe/Belgrade",
            "local": "2026-10-18T21:45:00+02:00",
            "weekday": "Sunday",
        }

    def test_the_local_day_can_differ_from_the_utc_day(self) -> None:
        at = datetime(2026, 10, 18, 23, 30, 0, tzinfo=UTC)
        tokyo = agui.clock(at, "Asia/Tokyo")
        assert tokyo["local"].startswith("2026-10-19T08:30")
        assert tokyo["weekday"] == "Monday"

    def test_an_unknown_zone_is_utc_and_says_so(self) -> None:
        at = datetime(2026, 10, 18, 19, 45, 0, tzinfo=UTC)
        for odd in ("Mars/Olympus", "", "../../etc/passwd"):
            told = agui.clock(at, odd)
            assert told["timezone"] == "UTC"
            assert told["local"] == "2026-10-18T19:45:00+00:00"


class TestTheRunInput:
    def test_the_items_are_present_only_when_known(self) -> None:
        bare = agui.build_run_input(
            thread_id="c1", run_id="m1", messages=[], channel_name="general", trigger_user="Ana"
        )
        assert {c["description"] for c in bare["context"]} == {"channel", "asked_by"}

        told = agui.build_run_input(
            thread_id="c1",
            run_id="m1",
            messages=[],
            channel_name="general",
            trigger_user="Ana",
            now={"utc": "2026-10-18T19:45:00Z", "timezone": "UTC"},
            channel_topic="Release week",
            channel_people=0,
        )
        context = {c["description"]: c["value"] for c in told["context"]}
        assert json.loads(context["now"])["utc"] == "2026-10-18T19:45:00Z"
        assert context["channel_topic"] == "Release week"
        # Zero is a count, not an absence.
        assert context["channel_people"] == "0"
        assert all(isinstance(c["value"], str) for c in told["context"])


async def test_a_run_is_told_the_time_where_the_asker_is_and_the_room(
    desk: dict[str, Any],
) -> None:
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text("UPDATE users SET timezone = 'Europe/Belgrade' WHERE id = :id"),
            {"id": desk["owner"].user_id},
        )
        await session.execute(
            text("UPDATE channels SET topic = 'Release week' WHERE id = :id"),
            {"id": desk["general"]},
        )

    asked = await send_message(desk["owner"], desk["general"], "@Helper what is left for today?")
    assert asked.status == 201, asked.body
    desk["state"]["scripts"] = [says("Two reviews and the notes.")]
    await agui_job.handle_agui_run(asked.body["message"]["id"])

    sent = json.loads(desk["state"]["seen"][-1].content)
    context = {item["description"]: item["value"] for item in sent["context"]}
    now = json.loads(context["now"])
    assert now["timezone"] == "Europe/Belgrade"
    assert now["local"][-6:] in ("+01:00", "+02:00")
    assert now["utc"].endswith("Z")
    assert context["channel_topic"] == "Release week"
    # The owner and the member: the agent itself is not counted among the people.
    assert context["channel_people"] == "2"
