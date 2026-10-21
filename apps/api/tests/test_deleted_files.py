"""A deleted message's files go with it (M3 · C3).

A delete cleared the words and left the files: still downloadable from their address,
still in the Files list, still in storage. Now every route refuses them — the uploader's
own requests included — and the nightly sweep deletes them from storage, then their rows.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs import retention as retention_job
from blob_api.lib import storage
from blob_api.lib.ids import new_id

from .helpers import Client, invite_and_sign_up, send_message, sign_up, workspace_id_of


@pytest_asyncio.fixture
async def room(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    olga = await sign_up(client, "Olga Owner")
    max_ = await invite_and_sign_up(olga, "Max Member")
    channels = {c["name"]: c["id"] for c in (await olga.get("/api/channels")).body["channels"]}
    general = channels["general"]
    await olga.post(f"/api/channels/{general}/members", {"userIds": [max_.user_id]})
    sent = await send_message(max_, general, "the plan, attached")
    message_id = sent.body["message"]["id"]
    key = f"uploads/{new_id()}/plan.txt"
    attachment_id = new_id()
    async with transaction() as (session, _):
        await session.execute(
            text(
                """
                INSERT INTO attachments (id, workspace_id, message_id, uploader_id, object_key,
                                         filename, mime, size_bytes, uploaded_at)
                VALUES (:id, :ws, :m, :u, :k, 'plan.txt', 'text/plain', 4, now())
                """
            ),
            {
                "id": attachment_id,
                "ws": await workspace_id_of(olga),
                "m": message_id,
                "u": max_.user_id,
                "k": key,
            },
        )
    bucket = {key}
    refused: set[str] = set()

    async def delete_object(object_key: str) -> None:
        if object_key in refused:
            raise RuntimeError("storage said no")
        bucket.discard(object_key)

    monkeypatch.setattr(storage, "delete_object", delete_object)
    return {
        "olga": olga,
        "max": max_,
        "general": general,
        "message": message_id,
        "key": key,
        "attachment": attachment_id,
        "bucket": bucket,
        "refused": refused,
    }


async def rows(attachment_id: str) -> int:
    async with SessionFactory() as session:
        return int(
            (
                await session.execute(
                    text("SELECT count(*) FROM attachments WHERE id = :id"), {"id": attachment_id}
                )
            ).scalar()
            or 0
        )


async def test_every_route_refuses_a_deleted_message_s_file(room: dict[str, Any]) -> None:
    download = f"/api/files/{quote(room['key'], safe='')}"
    assert (await room["olga"]._http.get(download)).status_code == 302
    listed = await room["olga"].get(f"/api/attachments?channelId={room['general']}")
    assert [f["id"] for f in listed.body["items"]] == [room["attachment"]]

    assert (await room["max"].delete(f"/api/messages/{room['message']}")).status == 200

    for person in (room["olga"], room["max"]):  # the uploader included
        assert (await person._http.get(download)).status_code == 404
        preview = await person._http.get(f"/api/attachments/{room['attachment']}/preview")
        assert preview.status_code == 404
    listed = await room["olga"].get(f"/api/attachments?channelId={room['general']}")
    assert listed.body["items"] == []


async def test_the_nightly_sweep_takes_them_out_of_storage_then_forgets_them(
    room: dict[str, Any],
) -> None:
    """With or without a retention window: a delete is a delete."""
    await room["max"].delete(f"/api/messages/{room['message']}")
    room["refused"].add(room["key"])

    await retention_job.sweep_history(now=datetime.now(UTC) + timedelta(minutes=1))
    assert await rows(room["attachment"]) == 1, "a row is the only record of an object"

    room["refused"].clear()
    await retention_job.sweep_history(now=datetime.now(UTC) + timedelta(minutes=1))
    assert room["key"] not in room["bucket"]
    assert await rows(room["attachment"]) == 0


async def test_a_live_message_s_file_is_left_alone(room: dict[str, Any]) -> None:
    await retention_job.sweep_history(now=datetime.now(UTC) + timedelta(minutes=1))
    assert room["key"] in room["bucket"]
    assert await rows(room["attachment"]) == 1
