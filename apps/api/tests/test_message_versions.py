"""Kept versions (ADR 0039 addendum): while a conversation, or a message's writer, is on
legal hold, an edit keeps the words it replaced — the two holds the writer is shown — for
an admin who may read the conversation and for the workspace export. Releasing the hold
that kept them removes them."""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.services import exports as export_service
from blob_api.services import retention as retention_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    olga = await sign_up(client, "Olga Owner")
    max_ = await invite_and_sign_up(olga, "Max Member")
    mia = await invite_and_sign_up(olga, "Mia Member")
    channels = {c["name"]: c["id"] for c in (await olga.get("/api/channels")).body["channels"]}
    general = channels["general"]
    for person in (max_, mia):
        await olga.post(f"/api/channels/{general}/members", {"userIds": [person.user_id]})
    return {"olga": olga, "max": max_, "mia": mia, "general": general}


async def _say(client: Client, channel: str, body: str) -> str:
    sent = await send_message(client, channel, body)
    assert sent.status == 201, sent.body
    return str(sent.body["message"]["id"])


async def _edit(client: Client, message: str, body: str) -> None:
    edited = await client.patch(f"/api/messages/{message}", {"body": body})
    assert edited.status == 200, edited.body


async def _kept(message: str) -> list[str]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT body FROM message_versions WHERE message_id = :m ORDER BY id"),
                {"m": message},
            )
        ).fetchall()
    return [row.body for row in rows]


async def _hold(olga: Client, kind: str, target: str, held: bool = True) -> None:
    placed = await olga.put(f"/api/admin/{kind}/{target}/legal-hold", {"held": held})
    assert placed.status == 200, placed.body


async def test_an_edit_keeps_nothing_without_a_hold(team: dict[str, Any]) -> None:
    message = await _say(team["max"], team["general"], "first words")
    await _edit(team["max"], message, "second words")
    assert await _kept(message) == []
    versions = await team["olga"].get(f"/api/admin/messages/{message}/versions")
    assert versions.body == {"versions": [], "held": False}


async def test_a_held_conversation_keeps_each_earlier_version(team: dict[str, Any]) -> None:
    olga, max_ = team["olga"], team["max"]
    message = await _say(max_, team["general"], "the budget is 10k")
    await _hold(olga, "channels", team["general"])
    await _edit(max_, message, "the budget is 12k")
    await _edit(max_, message, "the budget is 12k")  # the same words: nothing to keep
    await _edit(max_, message, "the budget is 15k")
    assert await _kept(message) == ["the budget is 10k", "the budget is 12k"]

    versions = (await olga.get(f"/api/admin/messages/{message}/versions")).body
    assert versions["held"] is True
    assert [v["body"] for v in versions["versions"]] == ["the budget is 10k", "the budget is 12k"]
    first, second = versions["versions"]
    assert first["writtenAt"] <= first["replacedAt"] <= second["writtenAt"] <= second["replacedAt"]
    # The message itself still says what it says now, to everybody.
    current = (await team["mia"].get(f"/api/messages/{message}")).body["message"]
    assert current["body"] == "the budget is 15k"
    # Not a member's to read.
    assert (await max_.get(f"/api/admin/messages/{message}/versions")).status == 403


async def test_a_held_writer_keeps_their_own_words_and_nobody_elses(team: dict[str, Any]) -> None:
    olga, max_, mia = team["olga"], team["max"], team["mia"]
    theirs = await _say(max_, team["general"], "max said this")
    others = await _say(mia, team["general"], "mia said this")
    await _hold(olga, "users", max_.user_id)
    await _edit(max_, theirs, "max changed it")
    # Mia is in a room with a custodian, which nobody tells her: her edit is not kept.
    await _edit(mia, others, "mia changed it")
    assert await _kept(theirs) == ["max said this"]
    assert await _kept(others) == []


async def test_releasing_a_hold_drops_what_it_alone_kept(team: dict[str, Any]) -> None:
    olga, max_, mia = team["olga"], team["max"], team["mia"]
    held_writer = await _say(max_, team["general"], "max v1")
    other = await _say(mia, team["general"], "mia v1")
    await _hold(olga, "channels", team["general"])
    await _hold(olga, "users", max_.user_id)
    await _edit(max_, held_writer, "max v2")
    await _edit(mia, other, "mia v2")

    # The conversation's hold goes: Mia's earlier words go with it; Max's stay, his own
    # hold kept them too.
    await _hold(olga, "channels", team["general"], held=False)
    assert await _kept(other) == []
    assert await _kept(held_writer) == ["max v1"]
    # Then his: nothing holds them now.
    await _hold(olga, "users", max_.user_id, held=False)
    assert await _kept(held_writer) == []


async def test_an_admin_reads_them_only_where_they_may_read(team: dict[str, Any]) -> None:
    olga, max_, mia = team["olga"], team["max"], team["mia"]
    board = (await max_.post("/api/channels", {"name": "board", "kind": "private"})).body[
        "channel"
    ]["id"]
    await max_.post(f"/api/channels/{board}/members", {"userIds": [mia.user_id]})
    message = await _say(max_, board, "private v1")
    await _hold(olga, "users", max_.user_id)
    await _edit(max_, message, "private v2")
    assert await _kept(message) == ["private v1"]
    # The admin is not in #board: it is 404 to her, versions included.
    assert (await olga.get(f"/api/admin/messages/{message}/versions")).status == 404


async def test_the_workspace_export_carries_them_and_a_personal_one_does_not(
    team: dict[str, Any],
) -> None:
    olga, max_ = team["olga"], team["max"]
    message = await _say(max_, team["general"], "export v1")
    await _hold(olga, "channels", team["general"])
    await _edit(max_, message, "export v2")
    async with SessionFactory() as session:
        workspace = [
            m async for m in export_service.messages_of(session, team["general"], versions=True)
        ]
        personal = [m async for m in export_service.messages_of(session, team["general"])]
    exported = next(m for m in workspace if m["id"] == message)
    assert exported["body"] == "export v2"
    assert [v["body"] for v in exported["versions"]] == ["export v1"]
    assert "versions" not in next(m for m in personal if m["id"] == message)
    # A message nobody edited carries no empty list.
    assert all("versions" not in m for m in workspace if m["id"] != message)


async def test_retention_takes_them_with_their_message(team: dict[str, Any]) -> None:
    olga, max_ = team["olga"], team["max"]
    message = await _say(max_, team["general"], "old v1")
    await _hold(olga, "channels", team["general"])
    await _edit(max_, message, "old v2")
    async with SessionFactory() as session, session.begin():
        await retention_service.tombstone(session, [message])
    assert await _kept(message) == []


async def test_a_delete_does_not_take_back_what_the_hold_kept(team: dict[str, Any]) -> None:
    olga, max_ = team["olga"], team["max"]
    message = await _say(max_, team["general"], "said v1")
    await _hold(olga, "channels", team["general"])
    await _edit(max_, message, "said v2")
    deleted = await max_.delete(f"/api/messages/{message}")
    assert deleted.status == 200, deleted.body
    # The delete took its words; the hold still has the ones the edit replaced.
    assert await _kept(message) == ["said v1"]
    versions = (await olga.get(f"/api/admin/messages/{message}/versions")).body
    assert [v["body"] for v in versions["versions"]] == ["said v1"]
    async with SessionFactory() as session:
        workspace = [
            m async for m in export_service.messages_of(session, team["general"], versions=True)
        ]
        personal = [m async for m in export_service.messages_of(session, team["general"])]
    exported = next(m for m in workspace if m["id"] == message)
    assert exported["body"] == "" and exported["deleted_at"]
    assert [v["body"] for v in exported["versions"]] == ["said v1"]
    assert all(m["id"] != message for m in personal)
