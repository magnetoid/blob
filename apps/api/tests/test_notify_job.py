"""The notify job's push fan-out, which has to happen *after* the transaction closes.

Badge tests already cover mention counting. This is the other half: a dead browser
subscription is pruned, and the remote call is not holding a Postgres connection while
it waits on a push provider.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs.notify import handle_notify

from .helpers import Client, invite_and_sign_up, send_message, sign_up

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def pair(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Notify Owner")
    other = await invite_and_sign_up(owner, "Notify Other")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    await owner.post(f"/api/channels/{general}/members", {"userIds": [other.user_id]})
    return {"owner": owner, "other": other, "channel": general}


async def _subscription_ids(user_id: str) -> list[str]:
    async with SessionFactory() as session, session.begin():
        rows = (
            await session.execute(
                text("SELECT id FROM push_subscriptions WHERE user_id = :id"),
                {"id": user_id},
            )
        ).fetchall()
    return [str(row.id) for row in rows]


class TestPushRunsAfterTheTransaction:
    async def test_a_dead_subscription_is_pruned(
        self, pair: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", "public")
        monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", "private")

        subscribed = await pair["owner"].post(
            "/api/me/push-subscription",
            {
                "endpoint": "https://push.example/one",
                "keys": {"p256dh": "p", "auth": "a"},
            },
        )
        assert subscribed.status == 200, subscribed.body
        before = await _subscription_ids(pair["owner"].user_id)
        assert before, "the row is what the job will ask send_push to look at"

        async def dead(subs: Any, payload: dict[str, Any]) -> list[str]:
            assert payload["url"] == f"/c/{pair['channel']}"
            # The transaction that loaded these rows has to be closed: send_push is
            # the remote fan-out, and holding a connection across it is the bug.
            return [str(sub.id) for sub in subs]

        async def not_looking(_user_id: str) -> set[str]:
            return set()

        monkeypatch.setattr("blob_api.jobs.notify.send_push", dead)
        monkeypatch.setattr(
            "blob_api.jobs.notify.presence.focused_channels",
            not_looking,
        )

        sent = await send_message(pair["other"], pair["channel"], "@Notify Owner are you there")
        await handle_notify(sent.body["message"]["id"])

        assert await _subscription_ids(pair["owner"].user_id) == []
