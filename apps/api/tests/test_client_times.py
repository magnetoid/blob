"""Every route that takes a time reads it the same way.

There were four, and each got it wrong differently — which is what a fourth copy of the
same six lines buys. `schedule` parsed and refused a naive one. `later` parsed, then
compared against an aware `now()`, so a time with no zone raised `TypeError` *past* the
`except ValueError` and answered 500. A task's due date and a status expiry accepted a
naive one and handed it to Postgres, which read it in the server's zone — "clear this at
10:00" quietly meaning ten o'clock somewhere the person had never been.

A time without an offset is a reading on a clock, and the server cannot know whose. All
four refuse it now, through one helper, with the sentence `schedule` already used.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio

from .helpers import Client, send_message, sign_up

pytestmark = pytest.mark.asyncio

NAIVE = "2027-01-01T10:00:00"
ZONED = "2027-01-01T10:00:00Z"


@pytest_asyncio.fixture
async def setup(client: Client) -> dict:
    owner = await sign_up(client, "Times Owner")
    channel = (await owner.get("/api/channels")).body["channels"][0]["id"]
    message = (await send_message(owner, channel, "anchor")).body["message"]["id"]
    return {"owner": owner, "channel": channel, "message": message}


async def _send(setup: dict, which: str, value: str):
    owner, channel, message = setup["owner"], setup["channel"], setup["message"]
    if which == "schedule":
        return await owner.post(
            f"/api/channels/{channel}/schedule",
            {"body": "later", "clientMsgId": str(uuid.uuid4()), "sendAt": value},
        )
    if which == "reminder":
        return await owner.patch(f"/api/saved/{message}", {"remindAt": value})
    if which == "status":
        return await owner.patch("/api/me", {"statusExpiresAt": value})
    return await owner.post(f"/api/threads/{message}/tasks", {"title": "do it", "dueAt": value})


ROUTES = ["schedule", "reminder", "status", "task"]


class TestATimeWithNoZone:
    @pytest.mark.parametrize("which", ROUTES)
    async def test_is_refused_rather_than_guessed_at(self, setup: dict, which: str) -> None:
        answer = await _send(setup, which, NAIVE)

        assert answer.status == 400, f"{which} accepted a naive time"
        assert answer.body["error"]["message"] == "That time needs a time zone."


class TestATimeThatIsNotOne:
    @pytest.mark.parametrize("which", ROUTES)
    async def test_is_refused_the_same_way_everywhere(self, setup: dict, which: str) -> None:
        answer = await _send(setup, which, "garbage")

        assert answer.status == 400, f"{which} accepted garbage"
        assert answer.body["error"]["message"] == "That isn't a time."


class TestAProperTime:
    @pytest.mark.parametrize("which", ROUTES)
    async def test_is_accepted(self, setup: dict, which: str) -> None:
        # The guard on the other side: refusing the ambiguous ones must not refuse the
        # ones the client actually sends.
        answer = await _send(setup, which, ZONED)

        assert answer.status in (200, 201), f"{which} rejected a zoned time: {answer.body}"


class TestAMomentThatHasPassed:
    async def test_is_refused_where_only_the_future_makes_sense(self, setup: dict) -> None:
        past = (datetime.now(UTC) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")

        assert (await _send(setup, "schedule", past)).status == 400
        assert (await _send(setup, "reminder", past)).status == 400

    async def test_but_allowed_where_it_is_meaningful(self, setup: dict) -> None:
        # A status expiry in the past is simply an expired status, and the read path
        # already drops those — refusing it would be inventing a rule.
        past = (datetime.now(UTC) - timedelta(hours=1)).isoformat().replace("+00:00", "Z")

        assert (await _send(setup, "status", past)).status == 200
