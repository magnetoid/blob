"""Deleting an orphaned upload, in an order that can survive storage being down.

The sweep used to `DELETE ... RETURNING object_key`, commit, and *then* delete the
objects — swallowing failures with a warning. The row is the only record that the object
exists, so a storage outage during the nightly sweep deleted every row, failed every
delete, and left the files behind with nothing left to find them by. No later sweep could
clean them up, because the evidence was gone with the rows.

The object goes first now. A failed delete keeps its row, and the next sweep tries again.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs import worker as worker_jobs
from blob_api.lib.ids import new_id

from .helpers import Client, sign_up, workspace_id_of

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def orphan(client: Client) -> dict:
    """An upload old enough to sweep, attached to nothing."""
    owner = await sign_up(client, "Sweep Owner")
    workspace = await workspace_id_of(owner)
    attachment_id = new_id()
    async with transaction() as (session, _):
        await session.execute(
            text(
                """
                INSERT INTO attachments
                  (id, workspace_id, uploader_id, message_id, object_key, filename,
                   mime, size_bytes, created_at)
                VALUES (cast(:id AS uuid), cast(:ws AS uuid), cast(:uid AS uuid), NULL,
                        :key, 'orphan.png', 'image/png', 10,
                        now() - interval '48 hours')
                """
            ),
            {
                "id": attachment_id,
                "ws": workspace,
                "uid": owner.user_id,
                "key": f"probe/{attachment_id}.png",
            },
        )
    return {"id": attachment_id, "key": f"probe/{attachment_id}.png"}


async def _row_exists(attachment_id: str) -> bool:
    async with SessionFactory() as session:
        found = (
            await session.execute(
                text("SELECT 1 FROM attachments WHERE id = cast(:id AS uuid)"),
                {"id": attachment_id},
            )
        ).fetchone()
    return found is not None


class TestWhenStorageAnswers:
    async def test_the_object_and_the_row_both_go(
        self, orphan: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        deleted: list[str] = []

        async def _delete(key: str) -> None:
            deleted.append(key)

        monkeypatch.setattr(worker_jobs, "delete_object", _delete)

        await worker_jobs.sweep_orphans({})

        assert orphan["key"] in deleted
        assert not await _row_exists(orphan["id"])


class TestWhenStorageIsDown:
    async def test_the_row_stays_so_the_next_sweep_can_find_the_file(
        self, orphan: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def _fail(_key: str) -> None:
            raise RuntimeError("S3 is unreachable")

        monkeypatch.setattr(worker_jobs, "delete_object", _fail)

        await worker_jobs.sweep_orphans({})

        # The row is the only thing that knows the object_key. Committing its deletion
        # while the object survives leaks the file permanently.
        assert await _row_exists(orphan["id"])

    async def test_and_the_sweep_after_it_succeeds(
        self, orphan: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        calls: list[str] = []

        async def _flaky(key: str) -> None:
            calls.append(key)
            if len(calls) == 1:
                raise RuntimeError("not this time")

        monkeypatch.setattr(worker_jobs, "delete_object", _flaky)

        await worker_jobs.sweep_orphans({})
        await worker_jobs.sweep_orphans({})

        assert calls == [orphan["key"], orphan["key"]]
        assert not await _row_exists(orphan["id"])


class TestAnAttachmentInUse:
    async def test_is_never_swept(self, orphan: dict, monkeypatch: pytest.MonkeyPatch) -> None:
        # The guard on the other side: only uploads attached to nothing are candidates.
        deleted: list[str] = []

        async def _delete(key: str) -> None:
            deleted.append(key)

        monkeypatch.setattr(worker_jobs, "delete_object", _delete)
        async with transaction() as (session, _):
            await session.execute(
                text("UPDATE attachments SET created_at = now() WHERE id = cast(:id AS uuid)"),
                {"id": orphan["id"]},
            )

        await worker_jobs.sweep_orphans({})

        assert deleted == []
        assert await _row_exists(orphan["id"])
