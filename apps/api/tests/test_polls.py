"""Polls (ADR 0041): a message whose text is the question, with options and votes beside it.

These pin that a poll is a message first — sent, read and searched as one — that a vote
replaces your choice and reaches the room once it commits, that one choice means one, that
an anonymous poll never serves a name to anybody, that a closed poll and an outsider are
both turned away, and that a question cannot change under its answers.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.realtime import hub
from blob_api.services import retention

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def room(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    ana = await invite_and_sign_up(owner, "Ana")
    bo = await invite_and_sign_up(owner, "Bo")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    frames: list[tuple[str, dict[str, Any]]] = []
    real = hub.to_channel

    def heard(channel_id: str, event: dict[str, Any]) -> None:
        frames.append((channel_id, event))
        real(channel_id, event)

    monkeypatch.setattr(hub, "to_channel", heard)
    return {"owner": owner, "ana": ana, "bo": bo, "general": general, "frames": frames}


async def ask(
    who: Client,
    channel: str,
    question: str = "Where should the offsite be?",
    options: list[str] | None = None,
    **flags: bool,
) -> Any:
    return await who.post(
        f"/api/channels/{channel}/messages",
        {
            "body": question,
            "clientMsgId": client_msg_id(),
            "poll": {"options": options or ["Lisbon", "Belgrade", "Tallinn"], **flags},
        },
    )


async def vote(who: Client, message_id: str, *option_ids: str) -> Any:
    return await who.put(f"/api/messages/{message_id}/poll/votes", {"optionIds": list(option_ids)})


async def poll_rows(message_id: str) -> tuple[int, int]:
    """How many poll rows and vote rows a message still has."""
    async with SessionFactory() as session:
        polls = (
            await session.execute(
                text("SELECT count(*) FROM polls WHERE message_id = :m"), {"m": message_id}
            )
        ).scalar_one()
        votes = (
            await session.execute(
                text("SELECT count(*) FROM poll_votes WHERE message_id = :m"), {"m": message_id}
            )
        ).scalar_one()
    return int(polls), int(votes)


def counts(message: dict[str, Any]) -> dict[str, int]:
    return {option["text"]: option["count"] for option in message["poll"]["options"]}


class TestAsking:
    async def test_a_poll_is_a_message_whose_text_is_the_question(
        self, room: dict[str, Any]
    ) -> None:
        sent = await ask(room["ana"], room["general"])
        assert sent.status == 201, sent.body
        message = sent.body["message"]
        assert message["body"] == "Where should the offsite be?"
        poll = message["poll"]
        assert [option["text"] for option in poll["options"]] == ["Lisbon", "Belgrade", "Tallinn"]
        assert [option["id"] for option in poll["options"]] == ["o1", "o2", "o3"]
        assert (poll["multiple"], poll["anonymous"], poll["voters"]) == (False, False, 0)
        assert poll["closedAt"] is None

        # Read back the way every reader reads it.
        history = await room["bo"].get(f"/api/channels/{room['general']}/messages")
        [read] = [m for m in history.body["messages"] if m["id"] == message["id"]]
        assert read["poll"]["options"][0]["text"] == "Lisbon"
        # And a plain message has none.
        plain = await room["bo"].post(
            f"/api/channels/{room['general']}/messages",
            {"body": "hello", "clientMsgId": client_msg_id()},
        )
        assert plain.body["message"].get("poll") is None

    @pytest.mark.parametrize(
        "options",
        [["Only one"], [f"Option {n}" for n in range(11)], ["Lunch", " lunch "], ["Yes", ""]],
    )
    async def test_what_a_poll_may_not_be_asked_with_is_refused(
        self, room: dict[str, Any], options: list[str]
    ) -> None:
        refused = await ask(room["ana"], room["general"], options=options)
        assert refused.status == 400, refused.body
        assert refused.body["error"]["code"] == "invalid_input"

    async def test_a_retried_send_asks_once(self, room: dict[str, Any]) -> None:
        payload = {
            "body": "Lunch?",
            "clientMsgId": client_msg_id(),
            "poll": {"options": ["Yes", "No"]},
        }
        first = await room["ana"].post(f"/api/channels/{room['general']}/messages", payload)
        again = await room["ana"].post(f"/api/channels/{room['general']}/messages", payload)
        assert (first.status, again.status) == (201, 200)
        assert again.body["message"]["id"] == first.body["message"]["id"]
        assert again.body["message"]["poll"]["options"][1]["text"] == "No"


class TestVoting:
    async def test_a_vote_counts_names_you_and_reaches_the_room(self, room: dict[str, Any]) -> None:
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        room["frames"].clear()

        voted = await vote(room["bo"], message_id, "o2")

        assert voted.status == 200, voted.body
        assert voted.body["mine"] == ["o2"]
        message = voted.body["message"]
        assert counts(message) == {"Lisbon": 0, "Belgrade": 1, "Tallinn": 0}
        assert message["poll"]["options"][1]["voterIds"] == [room["bo"].user_id]
        assert message["poll"]["voters"] == 1
        [(channel, event)] = [f for f in room["frames"] if f[1]["t"] == "message.updated"]
        assert channel == room["general"]
        assert counts(event["message"]) == counts(message)

    async def test_voting_again_replaces_and_nothing_withdraws(self, room: dict[str, Any]) -> None:
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        await vote(room["bo"], message_id, "o1")
        changed = await vote(room["bo"], message_id, "o3")
        assert counts(changed.body["message"]) == {"Lisbon": 0, "Belgrade": 0, "Tallinn": 1}
        withdrawn = await vote(room["bo"], message_id)
        assert counts(withdrawn.body["message"]) == {"Lisbon": 0, "Belgrade": 0, "Tallinn": 0}
        assert withdrawn.body["mine"] == []

    async def test_one_choice_means_one_unless_several_were_allowed(
        self, room: dict[str, Any]
    ) -> None:
        single = (await ask(room["ana"], room["general"])).body["message"]["id"]
        refused = await vote(room["bo"], single, "o1", "o2")
        assert refused.status == 400 and refused.body["error"]["code"] == "invalid_input"

        several = (await ask(room["ana"], room["general"], multiple=True)).body["message"]["id"]
        both = await vote(room["bo"], several, "o1", "o2")
        assert both.status == 200, both.body
        assert counts(both.body["message"]) == {"Lisbon": 1, "Belgrade": 1, "Tallinn": 0}
        assert both.body["message"]["poll"]["voters"] == 1

    async def test_an_option_it_does_not_have_is_refused(self, room: dict[str, Any]) -> None:
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        refused = await vote(room["bo"], message_id, "o9")
        assert refused.status == 400

    async def test_a_message_with_no_poll_takes_no_vote(self, room: dict[str, Any]) -> None:
        plain = await room["ana"].post(
            f"/api/channels/{room['general']}/messages",
            {"body": "hello", "clientMsgId": client_msg_id()},
        )
        refused = await vote(room["bo"], plain.body["message"]["id"], "o1")
        assert refused.status == 400
        assert refused.body["error"]["code"] == "not_a_poll"


class TestAnonymous:
    async def test_an_anonymous_poll_counts_and_never_names(self, room: dict[str, Any]) -> None:
        message_id = (await ask(room["ana"], room["general"], anonymous=True)).body["message"]["id"]
        voted = await vote(room["bo"], message_id, "o1")
        assert counts(voted.body["message"]) == {"Lisbon": 1, "Belgrade": 0, "Tallinn": 0}
        assert all(
            option["voterIds"] is None for option in voted.body["message"]["poll"]["options"]
        )

        # Not to whoever asked it, and not to the owner.
        for reader in (room["ana"], room["owner"]):
            history = await reader.get(f"/api/channels/{room['general']}/messages")
            [read] = [m for m in history.body["messages"] if m["id"] == message_id]
            assert all(option["voterIds"] is None for option in read["poll"]["options"])
            assert str(room["bo"].user_id) not in str(read["poll"])

        # Your own choice is told to you alone.
        assert (await room["bo"].get(f"/api/messages/{message_id}/poll")).body["mine"] == ["o1"]
        assert (await room["ana"].get(f"/api/messages/{message_id}/poll")).body["mine"] == []


class TestClosing:
    async def test_whoever_asked_closes_it_and_a_closed_poll_takes_no_votes(
        self, room: dict[str, Any]
    ) -> None:
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        await vote(room["bo"], message_id, "o1")
        not_theirs = await room["bo"].post(f"/api/messages/{message_id}/poll/close")
        assert not_theirs.status == 403

        closed = await room["ana"].post(f"/api/messages/{message_id}/poll/close")
        assert closed.status == 200, closed.body
        assert closed.body["message"]["poll"]["closedAt"].endswith("Z")
        refused = await vote(room["bo"], message_id, "o2")
        assert refused.status == 400 and refused.body["error"]["code"] == "poll_closed"
        assert counts(closed.body["message"])["Lisbon"] == 1

    async def test_an_admin_may_close_it(self, room: dict[str, Any]) -> None:
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        closed = await room["owner"].post(f"/api/messages/{message_id}/poll/close")
        assert closed.status == 200, closed.body


class TestBoundaries:
    async def test_an_outsider_cannot_see_or_vote_in_a_private_channels_poll(
        self, room: dict[str, Any]
    ) -> None:
        private = await room["ana"].post("/api/channels", {"name": "offsite", "kind": "private"})
        assert private.status in (200, 201), private.body
        channel = private.body["channel"]["id"]
        message_id = (await ask(room["ana"], channel)).body["message"]["id"]

        assert (await vote(room["bo"], message_id, "o1")).status == 404
        assert (await room["bo"].get(f"/api/messages/{message_id}/poll")).status == 404
        assert (await room["bo"].post(f"/api/messages/{message_id}/poll/close")).status == 404

    async def test_someone_not_in_the_channel_cannot_vote_in_it(self, room: dict[str, Any]) -> None:
        """Like a reaction: a member's act. A public channel Bo has not joined is readable
        to him and still not his to vote in."""
        public = await room["ana"].post("/api/channels", {"name": "trips", "kind": "public"})
        assert public.status in (200, 201), public.body
        message_id = (await ask(room["ana"], public.body["channel"]["id"])).body["message"]["id"]

        refused = await vote(room["bo"], message_id, "o1")
        assert refused.status in (403, 404), refused.body
        mine = await room["ana"].get(f"/api/messages/{message_id}/poll")
        assert mine.body["mine"] == []
        history = await room["ana"].get(f"/api/channels/{public.body['channel']['id']}/messages")
        [read] = [m for m in history.body["messages"] if m["id"] == message_id]
        assert read["poll"]["voters"] == 0

    async def test_an_archived_conversations_poll_takes_no_votes(
        self, room: dict[str, Any]
    ) -> None:
        channel = (await room["ana"].post("/api/channels", {"name": "old", "kind": "public"})).body[
            "channel"
        ]["id"]
        await room["bo"].post(f"/api/channels/{channel}/join")
        message_id = (await ask(room["ana"], channel)).body["message"]["id"]
        # Archiving is an admin's, and a member's: the owner joins to do it.
        await room["owner"].post(f"/api/channels/{channel}/join")
        archived = await room["owner"].post(f"/api/channels/{channel}/archive")
        assert archived.status == 200, archived.body

        refused = await vote(room["bo"], message_id, "o1")
        assert refused.status >= 400, refused.body

    async def test_the_question_cannot_change_under_its_answers(self, room: dict[str, Any]) -> None:
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        edited = await room["ana"].patch(f"/api/messages/{message_id}", {"body": "Something else?"})
        assert edited.status == 400, edited.body
        assert edited.body["error"]["code"] == "poll_question"

    async def test_deleting_the_message_takes_the_poll_and_who_chose_what(
        self, room: dict[str, Any]
    ) -> None:
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        await vote(room["bo"], message_id, "o1")
        assert (await room["ana"].delete(f"/api/messages/{message_id}")).status == 200

        assert await poll_rows(message_id) == (0, 0)
        refused = await vote(room["bo"], message_id, "o1")
        assert refused.status in (400, 404)

    async def test_retention_takes_a_poll_as_it_takes_reactions(self, room: dict[str, Any]) -> None:
        """ADR 0039: a swept message goes the way a delete does — the poll and its votes too."""
        message_id = (await ask(room["ana"], room["general"])).body["message"]["id"]
        await vote(room["bo"], message_id, "o2")

        async with transaction() as (session, _after):
            await retention.tombstone(session, [message_id])

        assert await poll_rows(message_id) == (0, 0)
