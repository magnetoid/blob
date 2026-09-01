"""A malformed id is the client's mistake, not the server's.

Ten of eleven id-taking endpoints answered `/api/messages/notauuid` with a 500: the
string went into the SQL, Postgres said `invalid input syntax for type uuid`, and that
surfaced as an internal error with a stack trace in the log. The body was safely generic,
so nothing leaked — but the status was wrong, the code was `internal` where the client
contract expects something it can branch on, and every scanner that walked the API filled
the log people actually read.

The distinction the tests below pin is the one that matters for privacy: a *malformed*
id is 400, because it cannot name anything, while a *well-formed but unknown* id stays
404 — the same answer a private channel gives, so membership is still unguessable.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up

pytestmark = pytest.mark.asyncio

#: Well-formed, and belongs to nothing.
ABSENT = "01a05834-0000-7000-8000-000000000000"


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    outsider = await invite_and_sign_up(owner, "Outsider")

    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    secret = (await owner.post("/api/channels", {"name": "secret-plans", "kind": "private"})).body[
        "channel"
    ]

    return {"owner": owner, "outsider": outsider, "general": general, "secret": secret}


class TestAMalformedId:
    async def test_is_a_client_error_on_every_shape_of_route(self, team: dict) -> None:
        owner = team["owner"]
        for path in (
            "/api/channels/notauuid",
            "/api/channels/notauuid/messages",
            "/api/channels/notauuid/members",
            "/api/channels/notauuid/pins",
            "/api/messages/notauuid",
            "/api/messages/notauuid/thread",
            "/api/users/notauuid",
        ):
            answer = await owner.get(path)
            assert answer.status == 400, f"{path} answered {answer.status}"
            assert answer.body["error"]["code"] == "invalid_input", path

    async def test_says_what_is_wrong_without_quoting_a_regex(self, team: dict) -> None:
        # Pydantic's own message here is `String should match pattern '^[0-9a-fA-F]{8}…'`,
        # which is a regex shown to somebody who followed a bad link.
        answer = await team["owner"].get("/api/messages/notauuid")

        assert answer.body["error"]["message"] == "That is not a valid id."
        assert answer.body["error"]["field"] == "message_id"

    async def test_covers_the_pagination_cursors_too(self, team: dict) -> None:
        # The other half of the same 500: a cursor is an id and reached the same SQL.
        channel_id = team["general"]["id"]
        for param in ("before", "after", "around"):
            answer = await team["owner"].get(
                f"/api/channels/{channel_id}/messages?{param}=notauuid"
            )
            assert answer.status == 400, param
            assert answer.body["error"]["field"] == param


class TestAWellFormedIdThatNamesNothing:
    async def test_is_still_a_404(self, team: dict) -> None:
        # The privacy-carrying answer. If a malformed id and an unknown one gave
        # different statuses from a *valid* id you are not allowed to see, the pair would
        # tell you which channels exist.
        for path in (f"/api/messages/{ABSENT}", f"/api/channels/{ABSENT}"):
            answer = await team["owner"].get(path)
            assert answer.status == 404, f"{path} answered {answer.status}"

    async def test_is_indistinguishable_from_one_you_cannot_see(self, team: dict) -> None:
        secret = team["secret"]["id"]

        absent = await team["outsider"].get(f"/api/channels/{ABSENT}")
        forbidden = await team["outsider"].get(f"/api/channels/{secret}")

        assert absent.status == forbidden.status == 404
        assert absent.body["error"]["code"] == forbidden.body["error"]["code"]


class TestARealIdStillWorks:
    async def test_history_and_its_cursor(self, team: dict) -> None:
        channel_id = team["general"]["id"]
        first = await team["owner"].get(f"/api/channels/{channel_id}/messages")
        assert first.status == 200

        messages = first.body["messages"]
        if messages:
            cursor = messages[0]["id"]
            page = await team["owner"].get(f"/api/channels/{channel_id}/messages?before={cursor}")
            assert page.status == 200


class TestAMalformedIdInsideABody:
    """The same fault, arriving by a different door.

    Constraining the path parameters left the bodies untouched, and a `threadRootId` or
    an `attachmentIds` entry reached exactly the same SQL. Only the request models are
    constrained: `schemas/models.py` describes what the server *sends*, and tightening
    that would turn a surprising stored value into a 500 on the way out — the failure
    this change exists to remove, pointed the other way.
    """

    async def test_a_reply_to_a_malformed_thread_root(self, team: dict) -> None:
        channel_id = team["general"]["id"]

        answer = await team["owner"].post(
            f"/api/channels/{channel_id}/messages",
            {"body": "hello", "clientMsgId": client_msg_id(), "threadRootId": "notauuid"},
        )

        assert answer.status == 400
        assert answer.body["error"]["code"] == "invalid_input"
        assert answer.body["error"]["field"] == "threadRootId"

    async def test_every_other_body_that_carries_one(self, team: dict) -> None:
        channel_id = team["general"]["id"]
        owner = team["owner"]
        cases = [
            (f"/api/channels/{channel_id}/members", {"userIds": ["notauuid"]}),
            (f"/api/channels/{channel_id}/read", {"lastReadMessageId": "notauuid"}),
            (f"/api/channels/{channel_id}/unread", {"messageId": "notauuid"}),
            ("/api/dms", {"userIds": ["notauuid"]}),
            ("/api/channels", {"name": "probe", "kind": "private", "memberIds": ["notauuid"]}),
        ]
        for path, payload in cases:
            answer = await owner.post(path, payload)
            assert answer.status == 400, f"{path} answered {answer.status}"
            assert answer.body["error"]["code"] == "invalid_input", path

    async def test_an_ordinary_send_is_untouched(self, team: dict) -> None:
        # The guard: the constraint must not reject the traffic the app actually sends.
        channel_id = team["general"]["id"]

        answer = await team["owner"].post(
            f"/api/channels/{channel_id}/messages",
            {"body": "an ordinary message", "clientMsgId": client_msg_id()},
        )

        assert answer.status == 201
