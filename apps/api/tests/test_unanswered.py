"""Unanswered questions: nudged once, quietly, only where the room asked for it.

Time goes through the job's `now=` seam rather than through rewinding rows, because the
sweep bounds its scan by UUIDv7 id — and a rewound `created_at` does not move an id.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs.reminders import fire_reminders
from blob_api.jobs.unanswered import nudge_unanswered
from blob_api.realtime import hub
from blob_api.services import unanswered as unanswered_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of

A_DAY_AND_A_BIT = timedelta(hours=unanswered_service.UNANSWERED_AFTER_HOURS, minutes=5)


def later(delta: timedelta = A_DAY_AND_A_BIT) -> datetime:
    return datetime.now(UTC) + delta


@pytest_asyncio.fixture
async def room(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")["id"]
    switched = await owner.patch(f"/api/channels/{general}", {"nudgeUnanswered": True})
    assert switched.status == 200, switched.body
    assert switched.body["channel"]["nudgeUnanswered"] is True
    return {"owner": owner, "member": member, "general": general}


async def ask(room: dict[str, Any], body: str = "Does anyone know why CI is red?") -> str:
    response = await send_message(room["owner"], room["general"], body)
    assert response.status == 201, response.body
    return str(response.body["message"]["id"])


async def saved_row(user_id: str, message_id: str) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text(
                    "SELECT remind_at, reminded_at, note, state FROM saved_items "
                    "WHERE user_id = :u AND message_id = :m"
                ),
                {"u": user_id, "m": message_id},
            )
        ).fetchone()


class TestWhatCountsAsAnswered:
    async def test_a_question_nobody_answered_becomes_a_reminder_for_its_asker(
        self, room: dict[str, Any]
    ) -> None:
        question = await ask(room)
        assert await nudge_unanswered({}, now=later()) == 1

        row = await saved_row(room["owner"].user_id, question)
        assert row is not None and row.remind_at is not None and row.reminded_at is None
        assert row.note == "No answer yet in #general: “Does anyone know why CI is red?”"

        # Once. The ratchet row is what makes the second sweep find nothing.
        assert await nudge_unanswered({}, now=later()) == 0
        async with SessionFactory() as session:
            assert await unanswered_service.nudged_for(session, question) is not None

    async def test_a_reply_in_the_thread_counts(self, room: dict[str, Any]) -> None:
        question = await ask(room)
        await send_message(room["member"], room["general"], "Flaky runner.", threadRootId=question)
        assert await nudge_unanswered({}, now=later()) == 0

    async def test_a_reaction_from_somebody_else_counts(self, room: dict[str, Any]) -> None:
        question = await ask(room)
        reacted = await room["member"].put(f"/api/messages/{question}/reactions", {"emoji": "✅"})
        assert reacted.status == 200, reacted.body
        assert await nudge_unanswered({}, now=later()) == 0

    async def test_the_askers_own_reaction_does_not_count(self, room: dict[str, Any]) -> None:
        question = await ask(room)
        await room["owner"].put(f"/api/messages/{question}/reactions", {"emoji": "👀"})
        assert await nudge_unanswered({}, now=later()) == 1

    async def test_a_later_message_by_somebody_else_counts(self, room: dict[str, Any]) -> None:
        await ask(room)
        await send_message(room["member"], room["general"], "Looking into it now.")
        assert await nudge_unanswered({}, now=later()) == 0

    async def test_the_askers_own_follow_up_does_not_count(self, room: dict[str, Any]) -> None:
        await ask(room)
        await send_message(room["owner"], room["general"], "Anyone? It is still red.")
        assert await nudge_unanswered({}, now=later()) == 1

    async def test_an_app_chiming_in_does_not_count(
        self, room: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.lib import net

        from .test_agentic import APP_MESSAGES, bot_client, install

        real = net.is_private_host

        async def only_that_host(hostname: str) -> bool:
            return False if hostname == "apps.example.com" else await real(hostname)

        monkeypatch.setattr(net, "is_private_host", only_that_host)
        await ask(room)
        installed = await install(room["owner"], APP_MESSAGES)
        app = bot_client(room["owner"], installed["botToken"])
        await app.post("/api/v1/conversations.join", {"channel": room["general"]})
        posted = await app.post(
            "/api/v1/chat.postMessage", {"channel": room["general"], "text": "Build #4412 passed."}
        )
        assert posted.status in (200, 201), posted.body
        # A CI notice is not somebody answering; the question is still open.
        assert await nudge_unanswered({}, now=later()) == 1

    async def test_a_mention_of_the_asker_in_another_thread_counts(
        self, room: dict[str, Any]
    ) -> None:
        await ask(room)
        other = (await send_message(room["member"], room["general"], "Unrelated: lunch?")).body[
            "message"
        ]["id"]
        # The member's channel message above already counts; undo that by asking again
        # after it, so only the mention in a thread reply can answer this one.
        question = await ask(room, "Second question: is the deploy frozen?")
        await send_message(
            room["member"], room["general"], "@Owner yes, frozen until Monday.", threadRootId=other
        )
        assert await nudge_unanswered({}, now=later()) == 0
        async with SessionFactory() as session:
            assert await unanswered_service.nudged_for(session, question) is None

    async def test_a_question_mark_before_a_quote_or_bang_still_counts(
        self, room: dict[str, Any]
    ) -> None:
        await ask(room, 'Did anyone read "the doc"?')
        await ask(room, "Seriously, nobody?!")
        assert await nudge_unanswered({}, now=later()) == 2

    async def test_a_statement_is_not_a_question(self, room: dict[str, Any]) -> None:
        await ask(room, "CI is red again.")
        assert await nudge_unanswered({}, now=later()) == 0

    async def test_a_room_that_did_not_switch_it_on_is_left_alone(
        self, room: dict[str, Any]
    ) -> None:
        quiet = (
            await room["owner"].post("/api/channels", {"name": "quiet", "kind": "public"})
        ).body["channel"]
        assert quiet["nudgeUnanswered"] is False
        await send_message(room["owner"], quiet["id"], "Is anybody in here?")
        assert await nudge_unanswered({}, now=later()) == 0


class TestTheWindow:
    async def test_too_early_and_too_late_are_both_nothing(self, room: dict[str, Any]) -> None:
        await ask(room)
        assert await nudge_unanswered({}, now=later(timedelta(hours=23))) == 0
        too_late = timedelta(
            hours=unanswered_service.UNANSWERED_AFTER_HOURS + unanswered_service.LOOKBACK_HOURS,
            minutes=10,
        )
        assert await nudge_unanswered({}, now=later(too_late)) == 0
        assert await nudge_unanswered({}, now=later()) == 1

    async def test_two_sweeps_at_once_nudge_once(self, room: dict[str, Any]) -> None:
        question = await ask(room)
        counts = await asyncio.gather(
            nudge_unanswered({}, now=later()), nudge_unanswered({}, now=later())
        )
        assert sorted(counts) == [0, 1]
        async with SessionFactory() as session:
            (count,) = (
                await session.execute(
                    text("SELECT count(*) FROM saved_items WHERE message_id = :m"),
                    {"m": question},
                )
            ).fetchone()
        assert count == 1


class TestWhoIsTold:
    async def test_a_muted_channel_is_an_answer_too(self, room: dict[str, Any]) -> None:
        await ask(room)
        muted = await room["owner"].patch(
            f"/api/channels/{room['general']}/membership", {"notifyLevel": "none"}
        )
        assert muted.status == 200
        assert await nudge_unanswered({}, now=later()) == 0
        await room["owner"].patch(
            f"/api/channels/{room['general']}/membership", {"notifyLevel": "mentions"}
        )
        assert await nudge_unanswered({}, now=later()) == 1

    async def test_a_person_who_opted_out_is_not_nudged(self, room: dict[str, Any]) -> None:
        await ask(room)
        off = await room["owner"].patch("/api/me/prefs", {"nudges": False})
        assert off.status == 200 and off.body["prefs"]["nudges"] is False
        assert await nudge_unanswered({}, now=later()) == 0
        await room["owner"].patch("/api/me/prefs", {"nudges": True})
        assert await nudge_unanswered({}, now=later()) == 1

    async def test_nobody_else_is_told(self, room: dict[str, Any]) -> None:
        question = await ask(room)
        assert await nudge_unanswered({}, now=later()) == 1
        assert await saved_row(room["member"].user_id, question) is None
        thread = await room["member"].get(f"/api/messages/{question}/thread")
        assert thread.status == 200
        assert [m for m in thread.body["messages"] if m["id"] != question] == []


class TestTheReminder:
    async def test_the_persons_own_reminder_is_left_alone(self, room: dict[str, Any]) -> None:
        question = await ask(room)
        tomorrow = (datetime.now(UTC) + timedelta(days=1)).isoformat().replace("+00:00", "Z")
        assert (
            await room["owner"].put(f"/api/messages/{question}/save", {"saved": True})
        ).status == 200
        set_own = await room["owner"].patch(f"/api/saved/{question}", {"remindAt": tomorrow})
        assert set_own.status == 200, set_own.body

        assert await nudge_unanswered({}, now=later()) == 1
        row = await saved_row(room["owner"].user_id, question)
        assert row.remind_at > datetime.now(UTC) + timedelta(hours=20)
        assert row.note is not None and row.note.startswith("No answer yet")

    async def test_something_already_dealt_with_is_not_resurfaced(
        self, room: dict[str, Any]
    ) -> None:
        question = await ask(room)
        await room["owner"].put(f"/api/messages/{question}/save", {"saved": True})
        done = await room["owner"].patch(f"/api/saved/{question}", {"state": "done"})
        assert done.status == 200, done.body

        assert await nudge_unanswered({}, now=later()) == 1
        row = await saved_row(room["owner"].user_id, question)
        assert row.state == "done" and row.remind_at is None

    async def test_it_fires_through_the_ordinary_reminder_sweep(self, room: dict[str, Any]) -> None:
        question = await ask(room)
        workspace_id = await workspace_id_of(room["owner"])
        conn = hub.new_connection("conn-1", room["owner"].user_id, workspace_id)
        hub.register(conn)

        assert await nudge_unanswered({}, now=later()) == 1
        await fire_reminders({})

        row = await saved_row(room["owner"].user_id, question)
        assert row.reminded_at is not None
        event = conn.outbox.get_nowait()
        assert event["t"] == "reminder.due"
        assert event["messageId"] == question
        assert "No answer yet in #general" in event["note"]


class TestTheSwitch:
    async def test_it_travels_with_the_channel(self, room: dict[str, Any]) -> None:
        listed = (await room["member"].get("/api/channels")).body["channels"]
        general = next(c for c in listed if c["id"] == room["general"])
        assert general["nudgeUnanswered"] is True
        off = await room["owner"].patch(f"/api/channels/{room['general']}", {"topic": "CI"})
        assert off.body["channel"]["nudgeUnanswered"] is True  # untouched by another field
        off = await room["owner"].patch(
            f"/api/channels/{room['general']}", {"nudgeUnanswered": False}
        )
        assert off.body["channel"]["nudgeUnanswered"] is False

    def test_the_note_quotes_the_question_briefly(self) -> None:
        question = unanswered_service.Question(
            id="q",
            workspace_id="w",
            channel_id="c",
            channel_name="ops",
            user_id="u",
            body="  Why   does the   deploy " + "x" * 200 + "?",
            notify_level="mentions",
            wants_nudges=True,
        )
        note = unanswered_service.note_for(question)
        assert note.startswith("No answer yet in #ops: “Why does the deploy ")
        assert note.endswith("…”")
        assert len(unanswered_service.excerpt(question.body)) == unanswered_service.EXCERPT_CHARS
        assert unanswered_service.wants(question)
        question.notify_level = "none"
        assert not unanswered_service.wants(question)
