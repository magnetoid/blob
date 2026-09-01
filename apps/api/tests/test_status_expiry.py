"""Setting a status that clears itself.

The column, the request schema and `serialize.to_user`'s expiry check all existed and
agreed. What never worked was writing one: the ISO string was bound straight into
`cast(:status_expires_at AS timestamptz)`, asyncpg reads that cast as the parameter's own
type, and it refuses a `str` — `expected a datetime.date or datetime.datetime instance`.
Every attempt to set an expiry was a 500, so the feature could not be used from any
client and the read path had never once been reached with a value in it.

Found while building the "Clear after" control the client was missing: the UI would have
shipped against a server route that always failed.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio

from .helpers import Client, sign_up

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Status Owner")


async def _me(owner: Client) -> dict:
    users = (await owner.get("/api/users")).body["users"]
    return next(u for u in users if u["displayName"] == "Status Owner")


class TestAStatusThatClearsItself:
    async def test_an_expiry_can_be_set_at_all(self, owner: Client) -> None:
        later = (datetime.now(UTC) + timedelta(hours=2)).isoformat().replace("+00:00", "Z")

        answer = await owner.patch(
            "/api/me",
            {"statusEmoji": "🎧", "statusText": "heads down", "statusExpiresAt": later},
        )

        assert answer.status == 200, answer.body
        assert answer.body["user"]["statusEmoji"] == "🎧"
        assert answer.body["user"]["statusExpiresAt"] is not None

    async def test_the_status_is_gone_once_it_has_passed(self, owner: Client) -> None:
        # Serialisation drops an expired status, which is why there is no cleanup job —
        # a property that could not be exercised while the write was a 500.
        past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat().replace("+00:00", "Z")

        await owner.patch(
            "/api/me",
            {"statusEmoji": "🌙", "statusText": "asleep", "statusExpiresAt": past},
        )

        me = await _me(owner)
        assert me["statusEmoji"] is None
        assert me["statusText"] is None
        assert me["statusExpiresAt"] is None

    async def test_a_status_with_no_expiry_still_stands(self, owner: Client) -> None:
        await owner.patch("/api/me", {"statusEmoji": "📗", "statusText": "reading"})

        me = await _me(owner)
        assert me["statusEmoji"] == "📗"
        assert me["statusExpiresAt"] is None

    async def test_null_clears_an_expiry_without_clearing_the_status(self, owner: Client) -> None:
        later = (datetime.now(UTC) + timedelta(hours=2)).isoformat().replace("+00:00", "Z")
        await owner.patch(
            "/api/me", {"statusEmoji": "🎧", "statusText": "x", "statusExpiresAt": later}
        )

        await owner.patch("/api/me", {"statusExpiresAt": None})

        me = await _me(owner)
        assert me["statusEmoji"] == "🎧"
        assert me["statusExpiresAt"] is None

    async def test_a_time_that_is_not_a_time_is_refused(self, owner: Client) -> None:
        # The same wording `later` and `schedule` give, because it is the same mistake.
        answer = await owner.patch("/api/me", {"statusExpiresAt": "garbage"})

        assert answer.status == 400
        assert answer.body["error"]["message"] == "That isn't a time."
