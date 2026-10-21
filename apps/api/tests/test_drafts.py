"""Drafts that follow you (M3 · B3, ADR 0037): yours alone, in rooms you can write to,
gone when sent, told to your own other devices and nobody else's."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.realtime import hub
from blob_api.services import drafts as draft_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def two(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    ana = await sign_up(client, "Ana Drafts")
    bo = await invite_and_sign_up(ana, "Bo Drafts")
    general = (await ana.get("/api/channels")).body["channels"][0]["id"]
    await ana.post(f"/api/channels/{general}/members", {"userIds": [bo.user_id]})
    told: list[tuple[list[str], dict[str, Any]]] = []
    monkeypatch.setattr(hub, "to_users", lambda ids, event: told.append((list(ids), event)))
    return {"ana": ana, "bo": bo, "general": general, "told": told}


async def save(person: Client, channel_id: str, body: str, root: str | None = None) -> Any:
    return await person.put(
        "/api/drafts", {"channelId": channel_id, "threadRootId": root, "body": body}
    )


async def test_a_draft_is_kept_listed_and_told_to_its_author_alone(two: dict[str, Any]) -> None:
    saved = await save(two["ana"], two["general"], "half a sentence")
    assert saved.status == 200, saved.body
    assert saved.body["draft"]["body"] == "half a sentence"

    listed = (await two["ana"].get("/api/drafts")).body["drafts"]
    assert [(d["channelId"], d["threadRootId"], d["body"]) for d in listed] == [
        (two["general"], None, "half a sentence")
    ]
    assert (await two["bo"].get("/api/drafts")).body["drafts"] == []
    ((ids, event),) = two["told"]
    assert ids == [two["ana"].user_id]
    assert event["t"] == "draft.updated" and event["body"] == "half a sentence"


async def test_an_empty_draft_is_forgotten(two: dict[str, Any]) -> None:
    await save(two["ana"], two["general"], "half a sentence")
    emptied = await save(two["ana"], two["general"], "   ")
    assert emptied.status == 200 and emptied.body["draft"] is None
    assert (await two["ana"].get("/api/drafts")).body["drafts"] == []
    assert two["told"][-1][1]["body"] == ""


async def test_a_reply_has_its_own_place(two: dict[str, Any]) -> None:
    root = (await send_message(two["ana"], two["general"], "plan")).body["message"]["id"]
    await save(two["ana"], two["general"], "in the channel")
    await save(two["ana"], two["general"], "in the thread", root)
    listed = {
        d["threadRootId"]: d["body"] for d in (await two["ana"].get("/api/drafts")).body["drafts"]
    }
    assert listed == {None: "in the channel", root: "in the thread"}


async def test_sending_clears_it_everywhere(two: dict[str, Any]) -> None:
    await save(two["ana"], two["general"], "ship it")
    two["told"].clear()
    sent = await send_message(two["ana"], two["general"], "ship it")
    assert sent.status == 201, sent.body
    assert (await two["ana"].get("/api/drafts")).body["drafts"] == []
    assert any(
        ids == [two["ana"].user_id] and event["t"] == "draft.updated" and event["body"] == ""
        for ids, event in two["told"]
    )


async def test_only_where_you_could_send_it(two: dict[str, Any]) -> None:
    private = await two["ana"].post("/api/channels", {"name": "board", "kind": "private"})
    assert private.status in (200, 201), private.body
    outsider = await save(two["bo"], private.body["channel"]["id"], "hello?")
    assert outsider.status == 404
    root = (await send_message(two["ana"], private.body["channel"]["id"], "x")).body["message"][
        "id"
    ]
    elsewhere = await save(two["ana"], two["general"], "wrong room", root)
    assert elsewhere.status == 404


async def test_leaving_a_room_takes_its_drafts_out_of_the_list(two: dict[str, Any]) -> None:
    made = await two["ana"].post("/api/channels", {"name": "side", "kind": "public"})
    room = made.body["channel"]["id"]
    await save(two["ana"], room, "never mind")
    left = await two["ana"].post(f"/api/channels/{room}/leave", {})
    assert left.status == 200, left.body
    assert (await two["ana"].get("/api/drafts")).body["drafts"] == []


async def test_old_drafts_go_and_the_newest_are_kept(two: dict[str, Any]) -> None:
    async with SessionFactory() as session, session.begin():
        await draft_service.save(
            session, two["ana"].user_id, channel_id=two["general"], thread_root_id=None, body="x"
        )
        await session.execute(text("UPDATE drafts SET updated_at = now() - interval '31 days'"))
        await draft_service.sweep(session, datetime.now(UTC))
        left = (await session.execute(text("SELECT count(*) FROM drafts"))).scalar_one()
    assert left == 0


async def test_a_person_keeps_two_hundred_at_most(two: dict[str, Any]) -> None:
    root = (await send_message(two["ana"], two["general"], "plan")).body["message"]["id"]
    async with SessionFactory() as session, session.begin():
        for i in range(draft_service.MAX_DRAFTS + 3):
            await session.execute(
                text(
                    """
                    INSERT INTO drafts
                      (user_id, place, channel_id, thread_root_id, body, updated_at)
                    VALUES (:u, :p, :c, :r, 'x', :at)
                    """
                ),
                {
                    "u": two["ana"].user_id,
                    "p": f"{two['general']}:{i}",
                    "c": two["general"],
                    "r": root,
                    "at": datetime.now(UTC) - timedelta(minutes=500 - i),
                },
            )
        await draft_service.save(
            session, two["ana"].user_id, channel_id=two["general"], thread_root_id=None, body="new"
        )
        count = (await session.execute(text("SELECT count(*) FROM drafts"))).scalar_one()
        newest = (
            await session.execute(text("SELECT body FROM drafts ORDER BY updated_at DESC LIMIT 1"))
        ).scalar_one()
    assert count == draft_service.MAX_DRAFTS
    assert newest == "new"
