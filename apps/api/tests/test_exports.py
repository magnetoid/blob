"""Exports (M3 · B4): what each kind holds, what it never does, and who may have it.

A workspace export is the public conversations and the people, an admin's; a personal one
is everything one person is in, theirs alone. The zip is built by the job and read back
here as the person who downloads it would read it.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import export as export_job
from blob_api.lib import storage

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def office(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Olga (owner), Max and Mia (members); #general public, #board private to Olga and
    Max, a DM between Max and Mia; and a bucket that keeps what is uploaded."""
    olga = await sign_up(client, "Olga Owner")
    max_ = await invite_and_sign_up(olga, "Max Member")
    mia = await invite_and_sign_up(olga, "Mia Member")
    channels = {c["name"]: c["id"] for c in (await olga.get("/api/channels")).body["channels"]}
    general, random = channels["general"], channels["random"]
    for person in (max_, mia):
        await olga.post(f"/api/channels/{general}/members", {"userIds": [person.user_id]})
    board = (await olga.post("/api/channels", {"name": "board", "kind": "private"})).body[
        "channel"
    ]["id"]
    await olga.post(f"/api/channels/{board}/members", {"userIds": [max_.user_id]})
    dm = (await max_.post("/api/dms", {"userIds": [mia.user_id]})).body["channel"]["id"]

    await send_message(olga, general, "Welcome, everyone")
    await send_message(olga, board, "Budget is tight")
    await send_message(max_, dm, "lunch?")

    kept: dict[str, bytes] = {}
    queued: list[tuple[str, str]] = []

    def upload(key: str, stream: Any, *, bucket: str) -> None:
        kept[key] = stream.read()

    async def enqueue(job: str, *args: Any) -> None:
        queued.append((job, *args))

    monkeypatch.setattr(storage, "upload_stream", upload)
    monkeypatch.setattr("blob_api.routers.exports.enqueue", enqueue)
    return {
        "olga": olga,
        "max": max_,
        "mia": mia,
        "general": general,
        "random": random,
        "board": board,
        "dm": dm,
        "kept": kept,
        "queued": queued,
    }


async def built(office: dict[str, Any], person: Client, path: str) -> dict[str, Any]:
    """Ask for an export, build it as the worker would, and open the zip."""
    asked = await person.post(path, {})
    assert asked.status == 200, asked.body
    (newest,) = [e for e in asked.body["exports"] if e["status"] == "pending"]
    await export_job.build_export(newest["id"])
    listed = await person.get(path)
    (done,) = [e for e in listed.body["exports"] if e["id"] == newest["id"]]
    assert done["status"] == "done", done
    key = export_job.object_key(person_workspace(office), newest["id"])
    archive = zipfile.ZipFile(io.BytesIO(office["kept"][key]))
    return {"export": done, "zip": archive}


def person_workspace(office: dict[str, Any]) -> str:
    return office["workspace"]


def lines(archive: zipfile.ZipFile, name: str) -> list[dict[str, Any]]:
    return [json.loads(line) for line in archive.read(name).decode().splitlines() if line]


@pytest.fixture(autouse=True)
async def _workspace(office: dict[str, Any]) -> None:
    office["workspace"] = (await office["olga"].get("/api/bootstrap")).body["workspace"]["id"]


async def test_a_personal_export_is_everything_you_are_in(office: dict[str, Any]) -> None:
    got = await built(office, office["max"], "/api/me/exports")
    archive = got["zip"]
    manifest = json.loads(archive.read("export.json"))
    assert manifest["format"] == "blob-export/1" and manifest["scope"] == "personal"
    rooms = {c["id"] for c in lines(archive, "channels.jsonl")}
    assert rooms == {office["general"], office["random"], office["board"], office["dm"]}
    said = {m["body"] for room in rooms for m in lines(archive, f"messages/{room}.jsonl")}
    assert {"Welcome, everyone", "Budget is tight", "lunch?"} <= said
    emails = {u["display_name"]: u.get("email") for u in lines(archive, "users.jsonl")}
    assert emails["Max Member"] == "max.member@example.com"
    assert emails["Olga Owner"] is None and emails["Mia Member"] is None


async def test_a_workspace_export_is_the_public_conversations_only(office: dict[str, Any]) -> None:
    got = await built(office, office["olga"], "/api/admin/exports")
    archive = got["zip"]
    rooms = {c["id"] for c in lines(archive, "channels.jsonl")}
    assert rooms == {office["general"], office["random"]}, "never #board, never a DM"
    names = archive.namelist()
    assert f"messages/{office['board']}.jsonl" not in names
    assert f"messages/{office['dm']}.jsonl" not in names
    emails = {u["display_name"]: u.get("email") for u in lines(archive, "users.jsonl")}
    assert emails["Mia Member"] == "mia.member@example.com"


async def test_only_admins_export_the_workspace(office: dict[str, Any]) -> None:
    assert (await office["max"].post("/api/admin/exports", {})).status == 403


async def test_a_download_answers_to_its_owner_and_a_workspace_one_to_admins(
    office: dict[str, Any],
) -> None:
    mine = await built(office, office["max"], "/api/me/exports")
    link = mine["export"]["downloadUrl"]
    assert (await office["max"].get(link)).status == 302
    assert (await office["mia"].get(link)).status == 404
    assert (await office["olga"].get(link)).status == 404, "a personal export is its owner's"

    theirs = await built(office, office["olga"], "/api/admin/exports")
    workspace_link = theirs["export"]["downloadUrl"]
    assert (await office["olga"].get(workspace_link)).status == 302
    assert (await office["max"].get(workspace_link)).status == 404


async def test_one_at_a_time(office: dict[str, Any]) -> None:
    assert (await office["max"].post("/api/me/exports", {})).status == 200
    again = await office["max"].post("/api/me/exports", {})
    assert again.status == 400
    assert "already being built" in again.body["error"]["message"]


async def test_a_failure_says_why(office: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(*_a: Any, **_k: Any) -> None:
        raise OSError("the bucket is gone")

    monkeypatch.setattr(storage, "upload_stream", broken)
    asked = await office["max"].post("/api/me/exports", {})
    (pending,) = asked.body["exports"]
    await export_job.build_export(pending["id"])
    (failed,) = (await office["max"].get("/api/me/exports")).body["exports"]
    assert failed["status"] == "failed" and "the bucket is gone" in failed["error"]
    assert failed["downloadUrl"] is None


async def test_a_week_later_it_is_gone(
    office: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    removed: list[str] = []
    monkeypatch.setattr(storage, "remove_object", lambda key, *, bucket: removed.append(key))
    got = await built(office, office["max"], "/api/me/exports")
    async with SessionFactory() as session, session.begin():
        await session.execute(text("UPDATE exports SET created_at = now() - interval '8 days'"))
    assert await export_job.sweep_exports(datetime.now(UTC)) == 1
    assert removed == [export_job.object_key(office["workspace"], got["export"]["id"])]
    assert (await office["max"].get("/api/me/exports")).body["exports"] == []
    _ = timedelta
