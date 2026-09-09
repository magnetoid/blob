"""Expired sessions, used reset tokens, dead deliveries and old audit rows go away."""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs.retention import sweep_retention
from blob_api.lib.ids import new_id

from .helpers import Client, sign_up, workspace_id_of

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def owner(client: Client) -> dict:
    user = await sign_up(client, "Retention Owner")
    return {"user": user, "workspace": await workspace_id_of(user)}


class TestRetentionSweep:
    async def test_expired_sessions_go(self, owner: dict) -> None:
        session_id = new_id()
        async with transaction() as (session, _):
            await session.execute(
                text(
                    """
                    INSERT INTO sessions (id, user_id, token_hash, expires_at)
                    VALUES (cast(:id AS uuid), cast(:uid AS uuid), :hash,
                            now() - interval '1 day')
                    """
                ),
                {"id": session_id, "uid": owner["user"].user_id, "hash": f"expired-{session_id}"},
            )

        counts = await sweep_retention()
        assert counts["sessions"] >= 1
        async with SessionFactory() as session:
            found = (
                await session.execute(
                    text("SELECT 1 FROM sessions WHERE id = cast(:id AS uuid)"),
                    {"id": session_id},
                )
            ).fetchone()
        assert found is None

    async def test_fresh_sessions_stay(self, owner: dict) -> None:
        # The signup fixture left a live session. Sweeping must not sign the tester out.
        before = (await owner["user"].get("/api/channels")).status
        await sweep_retention()
        after = (await owner["user"].get("/api/channels")).status
        assert before == after == 200
