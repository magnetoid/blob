"""Email when you are away (M3 · B3, ADR 0036).

What is addressed to somebody with no Blob open waits through their window; whatever is
still unread then goes out in one email. These pin who is held (and who never is), what
counts as read, the window, quiet hours, coming back, a refusing mail server, the email
itself, and the link that stops them without signing in.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from email import policy
from email.parser import BytesParser
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs import away_mail as away_mail_job
from blob_api.jobs.notify import handle_notify
from blob_api.lib import mail
from blob_api.lib.redis import redis
from blob_api.services import away_mail

from .helpers import Client, invite_and_sign_up, send_message, sign_up

LATER = timedelta(minutes=16)


@pytest_asyncio.fixture
async def people(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Ana (who will be away) and Bo, both in #general; a mail server that records; and
    presence that says nobody is at their desk unless a test says otherwise."""
    ana = await sign_up(client, "Ana Away")
    bo = await invite_and_sign_up(ana, "Bo Busy")
    general = (await ana.get("/api/channels")).body["channels"][0]["id"]
    await ana.post(f"/api/channels/{general}/members", {"userIds": [bo.user_id]})

    state: dict[str, Any] = {"ana": ana, "bo": bo, "general": general, "sent": [], "here": set()}

    async def record(to: str, subject: str, body: str, *, headers: Any = None) -> bool:
        state["sent"].append({"to": to, "subject": subject, "body": body, "headers": headers})
        return not state.get("refuse")

    async def presence_of(user_ids: list[str]) -> dict[str, str]:
        return {uid: ("active" if uid in state["here"] else "offline") for uid in user_ids}

    monkeypatch.setattr(mail, "send_mail", record)
    monkeypatch.setattr("blob_api.realtime.presence.get_presence", presence_of)
    return state


async def say(who: Client, channel_id: str, body: str, **extra: Any) -> str:
    sent = await send_message(who, channel_id, body, **extra)
    assert sent.status == 201, sent.body
    message_id = str(sent.body["message"]["id"])
    await handle_notify(message_id)
    return message_id


async def held_for(user_id: str) -> list[tuple[str, str]]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT message_id, reason FROM notification_mail WHERE user_id = :id"
                    " ORDER BY message_id"
                ),
                {"id": user_id},
            )
        ).fetchall()
    return [(str(row.message_id), row.reason) for row in rows]


async def dm_with(people: dict[str, Any]) -> str:
    opened = await people["bo"].post("/api/dms", {"userIds": [people["ana"].user_id]})
    assert opened.status == 200, opened.body
    return str(opened.body["channel"]["id"])


async def tick(at: timedelta = LATER) -> int:
    return await away_mail_job.send_away_mail(now=datetime.now(UTC) + at)


class TestWhoIsHeld:
    async def test_a_dm_and_a_mention_are_held_for_somebody_away(
        self, people: dict[str, Any]
    ) -> None:
        dm = await dm_with(people)
        first = await say(people["bo"], dm, "are you around?")
        second = await say(people["bo"], people["general"], "@Ana Away the numbers?")
        assert await held_for(people["ana"].user_id) == sorted([(first, "dm"), (second, "mention")])

    async def test_nobody_at_their_desk_is_held(self, people: dict[str, Any]) -> None:
        people["here"].add(people["ana"].user_id)
        await say(people["bo"], await dm_with(people), "are you around?")
        assert await held_for(people["ana"].user_id) == []

    async def test_a_broadcast_is_never_mailed(self, people: dict[str, Any]) -> None:
        await say(people["bo"], people["general"], "@channel the build is green")
        assert await held_for(people["ana"].user_id) == []

    async def test_off_is_off(self, people: dict[str, Any]) -> None:
        saved = await people["ana"].patch("/api/me/prefs", {"emailWhenAway": "off"})
        assert saved.status == 200, saved.body
        assert saved.body["prefs"]["emailWhenAway"] == "off"
        await say(people["bo"], await dm_with(people), "are you around?")
        assert await held_for(people["ana"].user_id) == []

    async def test_a_reply_in_a_thread_you_follow_is_held(self, people: dict[str, Any]) -> None:
        root = await say(people["bo"], people["general"], "plan for Friday")
        await say(people["ana"], people["general"], "I'll take it", threadRootId=root)
        reply = await say(people["bo"], people["general"], "thanks!", threadRootId=root)
        assert (reply, "thread") in await held_for(people["ana"].user_id)

    async def test_the_default_is_every_fifteen_minutes(self, people: dict[str, Any]) -> None:
        prefs = (await people["ana"].get("/api/bootstrap")).body["user"]["prefs"]
        assert prefs["emailWhenAway"] == "quarter_hour"


class TestTheEmail:
    async def test_it_waits_out_the_window_then_goes_once(self, people: dict[str, Any]) -> None:
        dm = await dm_with(people)
        message_id = await say(people["bo"], dm, "can you review the header before lunch?")
        assert await tick(timedelta(minutes=5)) == 0
        assert await tick() == 1

        (email,) = people["sent"]
        assert email["to"] == "ana.away@example.com"
        assert email["subject"] == "Bo Busy sent you a message"
        assert "can you review the header before lunch?" in email["body"]
        assert f"{settings.PUBLIC_URL}/m/{message_id}" in email["body"]
        assert email["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
        assert email["headers"]["List-Unsubscribe"].startswith(
            f"<{settings.PUBLIC_URL}/api/mail/unsubscribe?t="
        )
        assert email["headers"]["Auto-Submitted"] == "auto-generated"
        assert await held_for(people["ana"].user_id) == []
        assert await tick() == 0, "sent once"

    async def test_everything_waiting_goes_in_one(self, people: dict[str, Any]) -> None:
        dm = await dm_with(people)
        await say(people["bo"], dm, "one")
        await say(people["bo"], dm, "two")
        await say(people["bo"], people["general"], "@Ana Away three")
        assert await tick() == 1
        (email,) = people["sent"]
        assert email["subject"] == "3 messages waiting for you in Test Workspace"
        assert (
            email["body"].index("one") < email["body"].index("two") < email["body"].index("three")
        )

    async def test_what_was_read_is_not_mailed(self, people: dict[str, Any]) -> None:
        dm = await dm_with(people)
        message_id = await say(people["bo"], dm, "are you around?")
        read = await people["ana"].post(
            f"/api/channels/{dm}/read", {"lastReadMessageId": message_id}
        )
        assert read.status == 200, read.body
        assert await tick() == 0
        assert people["sent"] == []
        assert await held_for(people["ana"].user_id) == [], "dropped, not kept"

    async def test_a_thread_read_is_not_mailed(self, people: dict[str, Any]) -> None:
        root = await say(people["bo"], people["general"], "plan for Friday")
        await say(people["ana"], people["general"], "I'll take it", threadRootId=root)
        await say(people["bo"], people["general"], "thanks!", threadRootId=root)
        read = await people["ana"].post(f"/api/messages/{root}/thread/read", {})
        assert read.status == 200, read.body
        assert await tick() == 0

    async def test_a_mention_in_a_thread_you_do_not_follow_is_read_with_its_channel(
        self, people: dict[str, Any]
    ) -> None:
        """Reading such a thread records nothing, but the mention counted on the channel's
        badge — and reading the channel clears that."""
        root = await say(people["bo"], people["general"], "plan for Friday")
        await say(people["bo"], people["general"], "@Ana Away can you?", threadRootId=root)
        read = await people["ana"].post(
            f"/api/channels/{people['general']}/read", {"lastReadMessageId": root}
        )
        assert read.status == 200, read.body
        assert await tick() == 0

    async def test_left_unread_it_is_mailed(self, people: dict[str, Any]) -> None:
        root = await say(people["bo"], people["general"], "plan for Friday")
        await say(people["bo"], people["general"], "@Ana Away can you?", threadRootId=root)
        assert await tick() == 1
        assert people["sent"][0]["subject"] == "Bo Busy mentioned you in #general"
        assert "in a thread in #general" in people["sent"][0]["body"]

    async def test_coming_back_is_enough(self, people: dict[str, Any]) -> None:
        await say(people["bo"], await dm_with(people), "are you around?")
        people["here"].add(people["ana"].user_id)
        assert await tick() == 0
        assert await held_for(people["ana"].user_id) == []

    async def test_hourly_waits_an_hour(self, people: dict[str, Any]) -> None:
        await people["ana"].patch("/api/me/prefs", {"emailWhenAway": "hourly"})
        await say(people["bo"], await dm_with(people), "are you around?")
        assert await tick() == 0
        assert await tick(timedelta(minutes=61)) == 1
        assert "when you have no Blob open, at most once an hour." in people["sent"][0]["body"]

    async def test_quiet_hours_keep_it_for_later(self, people: dict[str, Any]) -> None:
        await say(people["bo"], await dm_with(people), "are you around?")
        until = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
        await people["ana"].patch("/api/me/prefs", {"snoozeUntil": until})
        assert await tick() == 0
        assert len(await held_for(people["ana"].user_id)) == 1, "kept, not dropped"
        await people["ana"].patch("/api/me/prefs", {"snoozeUntil": None})
        assert await tick() == 1

    async def test_a_room_left_is_not_mailed_about(self, people: dict[str, Any]) -> None:
        made = await people["bo"].post(
            "/api/channels",
            {"name": "secret-plans", "kind": "private", "memberIds": [people["ana"].user_id]},
        )
        assert made.status in (200, 201), made.body
        room = made.body["channel"]["id"]
        await say(people["bo"], room, "@Ana Away look at this")
        left = await people["ana"].post(f"/api/channels/{room}/leave", {})
        assert left.status == 200, left.body
        assert await tick() == 0

    async def test_a_refusing_mail_server_pauses_the_job(self, people: dict[str, Any]) -> None:
        people["refuse"] = True
        await say(people["bo"], await dm_with(people), "are you around?")
        assert await tick() == 0
        assert len(people["sent"]) == 1
        assert await redis.get(away_mail_job.PAUSE_KEY)
        assert len(await held_for(people["ana"].user_id)) == 1, "kept for after"
        assert await tick() == 0
        assert len(people["sent"]) == 1, "not asked again while paused"


class TestStoppingThem:
    async def test_the_link_says_whose_emails_it_stops_and_stops_them(
        self, people: dict[str, Any], client: Client
    ) -> None:
        await say(people["bo"], await dm_with(people), "are you around?")
        token = away_mail.unsubscribe_token(people["ana"].user_id)
        stranger = client.fork()  # no cookie: the link works signed out

        looked = await stranger.get(f"/api/mail/unsubscribe?t={token}")
        assert looked.status == 200, looked.body
        assert looked.body == {
            "email": "ana.away@example.com",
            "workspace": "Test Workspace",
            "off": False,
        }
        # One-click, as a mail provider sends it: from elsewhere, with no cookie.
        stopped = await stranger.post_raw(
            f"/api/mail/unsubscribe?t={token}",
            "List-Unsubscribe=One-Click",
            {
                "content-type": "application/x-www-form-urlencoded",
                "origin": "https://mail.example",
            },
        )
        assert stopped.status == 200, stopped.body
        assert stopped.body["off"] is True
        prefs = (await people["ana"].get("/api/bootstrap")).body["user"]["prefs"]
        assert prefs["emailWhenAway"] == "off"
        assert await held_for(people["ana"].user_id) == []
        again = await stranger.post(f"/api/mail/unsubscribe?t={token}", None)
        assert again.status == 200, "a client may send it twice"

    async def test_a_forged_link_does_nothing(self, people: dict[str, Any], client: Client) -> None:
        token = away_mail.unsubscribe_token(people["ana"].user_id)
        body, _signature = token.split(".", 1)
        for forged in (f"{body}.AAAA", "nonsense", f"{body}", ""):
            answer = await client.post(f"/api/mail/unsubscribe?t={forged}", None)
            assert answer.status in (400, 404), (forged, answer.status)
        prefs = (await people["ana"].get("/api/bootstrap")).body["user"]["prefs"]
        assert prefs["emailWhenAway"] == "quarter_hour"

    def test_a_token_is_for_one_account_and_one_purpose(self) -> None:
        token = away_mail.unsubscribe_token("0190a3c5-0000-7000-8000-000000000001")
        assert away_mail.read_unsubscribe_token(token) == "0190a3c5-0000-7000-8000-000000000001"
        from blob_api.plugins.commands import response_token

        command = response_token(plugin_id="p", channel_id="c", user_id="u")
        assert away_mail.read_unsubscribe_token(command) is None


class TestEveryMessage:
    async def test_carries_a_date_and_a_message_id(self, monkeypatch: pytest.MonkeyPatch) -> None:
        seen: list[Any] = []

        async def accept(raw: bytes, **kwargs: Any) -> None:
            seen.append((raw, kwargs))

        monkeypatch.setattr("aiosmtplib.send", accept)
        assert await mail.send_mail("a@example.com", "Hi", "Body", headers={"X-Test": "1"})
        ((raw, envelope),) = seen
        assert envelope["sender"] == "chat@example.com"
        assert envelope["recipients"] == ["a@example.com"]
        message = BytesParser(policy=policy.default).parsebytes(raw)
        assert message["Date"]
        assert message["Message-ID"].endswith("@example.com>")
        assert message["X-Test"] == "1"

    async def test_keeps_a_long_url_header_a_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Folded at 78 characters, the email package wrote a long header with no spaces
        as RFC 2047 encoded words — `=?utf-8?q?=3Chttps…` — which no mail client reads as
        the unsubscribe URL it was."""
        seen: list[bytes] = []

        async def accept(raw: bytes, **_kwargs: Any) -> None:
            seen.append(raw)

        monkeypatch.setattr("aiosmtplib.send", accept)
        url = "<https://blob.example.com/api/mail/unsubscribe?t=" + "x" * 160 + ">"
        await mail.send_mail("a@example.com", "Hi", "Body", headers={"List-Unsubscribe": url})
        assert f"List-Unsubscribe: {url}".encode() in seen[0]
