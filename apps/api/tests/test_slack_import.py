"""Importing a Slack export (ADR 0042), end to end: upload, read, choose, run in steps,
and the people it brought over claiming their accounts by invitation.

The zip is built in memory (`slack_fixture`) and stands in for the bucket's copy; a
file's bytes come from a fake fetch, keyed by the link the export gave.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.jobs import slack_import as job
from blob_api.lib import storage
from blob_api.lib.errors import AppError
from blob_api.services import signup as signup_service
from blob_api.services import slack_history as history

from .helpers import Client, invite_and_sign_up, sign_up
from .slack_fixture import build_export, channel, message, user

pytestmark = pytest.mark.asyncio

T1 = "1704103200.000100"  # 2024-01-01 10:00:00.0001
T2 = "1704103260.000200"
T3 = "1704103320.000300"
T4 = "1704103380.000400"
T5 = "1704103440.000500"
T6 = "1704103500.000600"
SLACK_FILE = "https://files.slack.com/files-pri/T1-F1/download/plan.pdf?t=xoxe-secret-token"
BIG_FILE = "https://files.slack.com/files-pri/T1-F2/download/video.mov?t=xoxe-secret-token"


def _export(path: Path) -> Path:
    return build_export(
        path,
        users=[
            user("U1", "Olga Owner", email="olga.owner@example.com"),
            user("U2", "Pat Lee", email="pat@example.com", display="pat"),
            user("U3", "Gone Person", deleted=True),
            user("U4", "Bob Builder", email="BOB@example.com"),
            user("UB", "GitHub", bot=True),
        ],
        channels=[
            channel("C1", "general", ["U1", "U2"]),
            channel("C2", "Launch Plans!", ["U1", "U2", "UB"], archived=True),
        ],
        groups=[channel("G1", "leads", ["U2", "U4"])],
        dms=[{"id": "D1", "created": 1_600_000_000, "members": ["U1", "U2"]}],
        days={
            "general": {
                "2024-01-01": [
                    message(
                        "U2",
                        T1,
                        "Hello <@U1> :tada: see <#C2|launch-plans>",
                        reactions=[{"name": "+1", "users": ["U1", "U2"], "count": 2}],
                        thread_ts=T1,
                        reply_count=2,
                    ),
                    message("U1", T2, "a *reply*", thread_ts=T1, parent_user_id="U2"),
                    message(
                        "U1",
                        T3,
                        "said in the channel too",
                        thread_ts=T1,
                        subtype="thread_broadcast",
                    ),
                    {
                        "type": "message",
                        "subtype": "channel_join",
                        "user": "U2",
                        "ts": T4,
                        "text": "<@U2> has joined the channel",
                    },
                    {
                        "type": "message",
                        "subtype": "bot_message",
                        "bot_id": "BX1",
                        "username": "deploy-bot",
                        "ts": T5,
                        "text": "",
                        "attachments": [{"title": "Deployed", "text": "v1.2 is out"}],
                    },
                    message(
                        "U2",
                        T6,
                        "the plan",
                        files=[
                            {
                                "id": "F1",
                                "name": "plan.pdf",
                                "mimetype": "application/pdf",
                                "size": 9,
                                "url_private_download": SLACK_FILE,
                            },
                            {
                                "id": "F2",
                                "name": "video.mov",
                                "mimetype": "video/quicktime",
                                "size": 900 * 1024 * 1024,
                                "url_private_download": BIG_FILE,
                            },
                            {"id": "F3", "name": "old.png", "mode": "hidden_by_limit"},
                            {
                                "id": "F4",
                                "name": "Spec",
                                "mode": "external",
                                "is_external": True,
                                "url_private": "https://docs.example.com/spec",
                            },
                        ],
                    ),
                ]
            },
            "Launch Plans!": {
                "2024-01-02": [
                    message("U3", "1704189600.000100", "before I left"),
                    {
                        "type": "message",
                        "user": "U9",
                        "ts": "1704189660.000200",
                        "text": "a guest from another team",
                        "user_profile": {"real_name": "Gita Guest", "display_name": "gita"},
                    },
                ]
            },
            "leads": {"2024-01-01": [message("U4", "1704103200.000900", "private talk")]},
            "D1": {"2024-01-03": [message("U1", "1704276000.000100", "just us")]},
        },
    )


@pytest_asyncio.fixture
async def team(client: Client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Any]:
    olga = await sign_up(client, "Olga Owner")
    zip_path = _export(tmp_path / "export.zip")
    stored: dict[str, bytes] = {}
    queued: list[tuple[Any, ...]] = []
    deleted: list[str] = []

    async def enqueue(name: str, *args: Any) -> None:
        queued.append((name, *args))

    async def size_of(_key: str) -> int:
        return zip_path.stat().st_size

    def download(_key: str, path: str, *, bucket: str) -> None:
        shutil.copyfile(zip_path, path)

    async def put(key: str, body: bytes, mime: str) -> None:
        stored[key] = body

    async def drop(key: str) -> None:
        deleted.append(key)

    fetched: list[str] = []
    ensured: list[bool] = []

    async def ensure() -> None:
        ensured.append(True)

    async def fetch(url: str, limit: int) -> bytes | None:
        fetched.append(url)
        return b"%PDF-1.4\n" if url == SLACK_FILE else None

    monkeypatch.setattr(settings, "SLACK_IMPORT_DIR", str(tmp_path / "imports"))
    monkeypatch.setattr("blob_api.routers.slack_import.enqueue", enqueue)
    monkeypatch.setattr("blob_api.routers.slack_import.object_size", size_of)
    monkeypatch.setattr("blob_api.routers.slack_import.delete_object", drop)
    monkeypatch.setattr("blob_api.routers.slack_import.ensure_bucket", ensure)
    monkeypatch.setattr(job, "enqueue", enqueue)
    monkeypatch.setattr(job, "fetch", fetch)
    monkeypatch.setattr(storage, "download_to", download)
    monkeypatch.setattr(storage, "put_object", put)
    monkeypatch.setattr(storage, "delete_object", drop)
    return {
        "olga": olga,
        "zip": zip_path,
        "stored": stored,
        "queued": queued,
        "deleted": deleted,
        "fetched": fetched,
        "ensured": ensured,
    }


async def _uploaded(team: dict[str, Any]) -> str:
    olga: Client = team["olga"]
    created = await olga.post("/api/admin/import", {"sizeBytes": team["zip"].stat().st_size})
    assert created.status == 200, created.body
    assert created.body["uploadUrl"]
    # On a fresh server the zip may be the first thing the bucket is asked to hold.
    assert team["ensured"]
    import_id = created.body["current"]["id"]
    assert created.body["current"]["status"] == "uploading"
    read = await olga.post(f"/api/admin/import/{import_id}/uploaded")
    assert read.body["current"]["status"] == "reading"
    await asyncio.sleep(0.05)  # queued past COMMIT, on the loop
    assert ("slack_import_read", import_id) in team["queued"]
    await job.read(import_id)
    return str(import_id)


async def _run(team: dict[str, Any], import_id: str, **choices: bool) -> dict[str, Any]:
    started = await team["olga"].post(f"/api/admin/import/{import_id}/start", choices)
    assert started.status == 200, started.body
    for _ in range(10):
        await job.step(import_id)
        state = (await team["olga"].get("/api/admin/import")).body["current"]
        if state["status"] != "running":
            return dict(state)
    raise AssertionError("the import did not finish")


async def _rows(sql: str, **params: Any) -> list[Any]:
    async with SessionFactory() as session:
        return list((await session.execute(text(sql), params)).fetchall())


async def _channel(name: str) -> Any:
    rows = await _rows("SELECT * FROM channels WHERE name = :name", name=name)
    return rows[0] if rows else None


async def test_reading_says_what_the_zip_holds_before_anything_is_written(
    team: dict[str, Any],
) -> None:
    import_id = await _uploaded(team)
    state = (await team["olga"].get("/api/admin/import")).body
    current = state["current"]
    assert current["id"] == import_id and current["status"] == "ready"
    assert current["preview"] == {
        "publicChannels": 2,
        "privateChannels": 1,
        "directMessages": 1,
        "groupMessages": 0,
        "publicDays": 2,
        "privateDays": 2,
        "people": 3,
        "matched": 1,
        "placeholders": 2,
        "withoutAddress": 0,
        "apps": 1,
        "merging": ["general"],
    }
    assert state["maxBytes"] == settings.SLACK_IMPORT_MAX_BYTES
    # Nothing written yet: nobody new, no channel from the zip.
    assert await _rows("SELECT 1 FROM users WHERE placeholder") == []
    assert await _channel("launch-plans") is None


async def test_public_history_arrives_written_not_sent(team: dict[str, Any]) -> None:
    import_id = await _uploaded(team)
    olga: Client = team["olga"]
    general = (await _channel("general")).id
    before = await _rows(
        "SELECT last_read_message_id FROM read_states WHERE user_id = :u AND channel_id = :c",
        u=olga.user_id,
        c=general,
    )
    done = await _run(team, import_id, includePrivate=False, copyFiles=True)
    assert done["status"] == "done", done
    assert done["progress"]["conversationsTotal"] == 2
    assert done["progress"]["conversations"] == 2

    rows = await _rows(
        """
        SELECT m.id, m.body, m.kind, m.thread_root_id, m.also_in_channel, m.mention_user_ids,
               m.reply_count, m.reply_user_ids, m.created_at, m.client_msg_id, u.display_name,
               u.placeholder
          FROM messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.channel_id = :c AND m.client_msg_id LIKE 'slack:%'
         ORDER BY m.id
        """,
        c=general,
    )
    bodies = [row.body for row in rows]
    # Into the #general that was already here; the join notice left out.
    assert bodies[0] == "Hello @Olga Owner 🎉 see #launch-plans"
    assert bodies[1] == "a **reply**"
    assert bodies[2] == "said in the channel too"
    # An app's message with no text of its own is what its attachments said.
    assert bodies[3] == "Deployed\nv1.2 is out"
    assert not any("has joined" in body for body in bodies)

    root, reply, broadcast, app = rows[0], rows[1], rows[2], rows[3]
    assert str(root.created_at.isoformat()).startswith("2024-01-01T10:00:00.000100")
    assert root.id < reply.id < broadcast.id < app.id
    assert root.client_msg_id == f"slack:C1:{T1}"
    assert root.mention_user_ids == [olga.user_id]
    assert root.display_name == "pat" and root.placeholder
    assert str(reply.thread_root_id) == str(root.id) and not reply.also_in_channel
    assert str(broadcast.thread_root_id) == str(root.id) and broadcast.also_in_channel
    assert root.reply_count == 2
    assert [str(u) for u in root.reply_user_ids] == [olga.user_id]
    assert app.kind == "bot" and app.display_name == "deploy-bot"

    reactions = await _rows(
        "SELECT emoji, user_id FROM reactions WHERE message_id = :m ORDER BY user_id",
        m=root.id,
    )
    assert {r.emoji for r in reactions} == {"👍"} and len(reactions) == 2

    # Nobody was told: no activity, no unread mention, and Olga's place in #general is
    # where it was — the history is older than it.
    assert await _rows("SELECT 1 FROM activity_events") == []
    after = await _rows(
        "SELECT last_read_message_id, mention_count FROM read_states"
        " WHERE user_id = :u AND channel_id = :c",
        u=olga.user_id,
        c=general,
    )
    assert after[0].last_read_message_id == before[0].last_read_message_id
    assert after[0].mention_count == 0

    # A channel the import made: Slack's name as Blob takes one, archived as it was, read
    # to its end by everybody in it, the app not among its members.
    launch = await _channel("launch-plans")
    assert launch is not None and launch.kind == "public" and launch.archived_at is not None
    assert launch.topic == "Launch Plans! topic"
    members = await _rows(
        "SELECT u.display_name, u.kind FROM channel_members cm JOIN users u ON u.id = cm.user_id"
        " WHERE cm.channel_id = :c ORDER BY u.display_name",
        c=launch.id,
    )
    assert [(m.display_name, m.kind) for m in members] == [
        ("Olga Owner", "human"),
        ("pat", "human"),
    ]
    read = await _rows(
        "SELECT r.last_read_message_id = c.last_message_id AS at_end FROM read_states r"
        " JOIN channels c ON c.id = r.channel_id WHERE r.user_id = :u AND r.channel_id = :c",
        u=olga.user_id,
        c=launch.id,
    )
    assert read and read[0].at_end
    said = await _rows(
        "SELECT m.body, u.display_name, u.placeholder FROM messages m"
        " JOIN users u ON u.id = m.author_id WHERE m.channel_id = :c ORDER BY m.id",
        c=launch.id,
    )
    # Somebody deleted in Slack, and a guest from another team, keep their names.
    assert [(s.body, s.display_name) for s in said] == [
        ("before I left", "Gone Person"),
        ("a guest from another team", "gita"),
    ]

    # Private conversations were not asked for.
    assert await _channel("leads") is None
    assert await _rows("SELECT 1 FROM channels WHERE kind = 'dm'") == []
    # The zip, which holds every file link's token, is gone.
    assert any(key.endswith(f"{import_id}.zip") for key in team["deleted"])


async def test_files_are_copied_within_limits_and_their_tokens_kept_nowhere(
    team: dict[str, Any],
) -> None:
    import_id = await _uploaded(team)
    done = await _run(team, import_id, includePrivate=False, copyFiles=True)
    assert done["progress"]["filesCopied"] == 1
    assert done["progress"]["filesSkipped"] == 3
    # Only the one under the cap was fetched, and only from Slack's file host.
    assert team["fetched"] == [SLACK_FILE]
    plan = await _rows(
        "SELECT a.filename, a.mime, a.size_bytes, a.message_id, m.body FROM attachments a"
        " JOIN messages m ON m.id = a.message_id"
    )
    assert len(plan) == 1 and plan[0].filename == "plan.pdf" and plan[0].size_bytes == 9
    body = plan[0].body
    assert body.startswith("the plan\n")
    assert "📎 video.mov was not copied from Slack: it is larger than 25 MB." in body
    assert "📎 old.png was hidden by Slack's plan, so it could not be copied." in body
    assert "📎 [Spec](https://docs.example.com/spec) is kept outside Slack." in body
    for table, column in (
        ("messages", "body"),
        ("attachments", "object_key"),
        ("imports", "problems::text"),
    ):
        leaked = await _rows(f"SELECT 1 FROM {table} WHERE {column} LIKE '%xoxe%'")
        assert leaked == [], table


async def test_private_conversations_come_only_when_asked_and_only_to_their_members(
    team: dict[str, Any],
) -> None:
    import_id = await _uploaded(team)
    done = await _run(team, import_id, includePrivate=True, copyFiles=False)
    assert done["status"] == "done"
    leads = await _channel("leads")
    assert leads is not None and leads.kind == "private"
    members = await _rows(
        "SELECT u.display_name FROM channel_members cm JOIN users u ON u.id = cm.user_id"
        " WHERE cm.channel_id = :c ORDER BY 1",
        c=leads.id,
    )
    # Its members from Slack — and not the admin who imported it, who was not in it.
    assert [m.display_name for m in members] == ["Bob Builder", "pat"]
    dms = await _rows("SELECT id, kind FROM channels WHERE kind = 'dm'")
    assert len(dms) == 1
    assert (await _rows("SELECT body FROM messages WHERE channel_id = :c", c=dms[0].id))[
        0
    ].body == "just us"
    # Without copying, a file is a line saying so.
    lines = await _rows("SELECT body FROM messages WHERE body LIKE 'the plan%'")
    assert "📎 plan.pdf was not copied from Slack." in lines[0].body
    assert team["fetched"] == []


async def test_running_it_again_writes_nothing_twice(team: dict[str, Any]) -> None:
    first = await _uploaded(team)
    await _run(team, first, includePrivate=True, copyFiles=False)
    counts = await _rows(
        "SELECT (SELECT count(*) FROM messages) AS m, (SELECT count(*) FROM users) AS u,"
        " (SELECT count(*) FROM channels) AS c, (SELECT count(*) FROM reactions) AS r"
    )
    second = await _uploaded(team)
    done = await _run(team, second, includePrivate=True, copyFiles=False)
    assert done["status"] == "done"
    assert done["progress"]["peopleCreated"] == 0
    assert done["progress"]["messages"] == 0
    assert (
        await _rows(
            "SELECT (SELECT count(*) FROM messages) AS m, (SELECT count(*) FROM users) AS u,"
            " (SELECT count(*) FROM channels) AS c, (SELECT count(*) FROM reactions) AS r"
        )
        == counts
    )


async def test_a_placeholder_is_claimed_only_through_an_invitation_to_its_address(
    team: dict[str, Any],
) -> None:
    olga: Client = team["olga"]
    import_id = await _uploaded(team)
    await _run(team, import_id, includePrivate=True, copyFiles=False)
    pat = (await _rows("SELECT * FROM users WHERE email = 'pat@example.com'"))[0]
    assert pat.placeholder and pat.deactivated_at is not None and pat.password_hash is None

    # Not by signing in, not by an open link, not by being switched back on.
    login = await olga.fork().post(
        "/api/auth/login", {"email": "pat@example.com", "password": "correct-horse-battery"}
    )
    assert login.status == 401 and "deactivated" not in str(login.body)
    open_link = (await olga.post("/api/invites", {"expiresInDays": 1})).body["url"]
    refused = await olga.fork().post(
        "/api/auth/signup",
        {
            "email": "pat@example.com",
            "password": "correct-horse-battery",
            "displayName": "Pat Lee",
            "inviteToken": open_link.split("/join/")[1],
        },
    )
    assert refused.status == 400 and "invite this address" in refused.body["error"]["message"]
    reactivate = await olga.post(f"/api/admin/users/{pat.id}/reactivate")
    assert reactivate.status == 400
    with pytest.raises(AppError) as no_invite:
        async with SessionFactory() as session:
            await signup_service.join_by_identity(
                session,
                email="pat@example.com",
                display_name="Pat",
                invite_token=None,
                workspace_id=str(pat.workspace_id),
            )
    assert no_invite.value.code == "invite_required"

    # The people page and the import's list both offer Pat — and not the app.
    people = (await olga.get(f"/api/admin/import/{import_id}/people")).body["people"]
    assert [p["email"] for p in people] == ["bob@example.com", "pat@example.com"]
    listed = {u["email"]: u for u in (await olga.get("/api/admin/users")).body["users"]}
    assert listed["pat@example.com"]["placeholder"] and listed["pat@example.com"]["invitable"]
    # An app is a name on its messages, never an invitee — and an app that never posted
    # (Slack lists GitHub as a user too) is not an account at all.
    assert not listed["slack-b-bx1@slack-import.invalid"]["invitable"]
    assert "slack-ub@slack-import.invalid" not in listed
    # A person the export had no address for is a name on old messages, never an invitee.
    assert listed["slack-u3@slack-import.invalid"]["placeholder"]
    assert not listed["slack-u3@slack-import.invalid"]["invitable"]

    invited = await olga.post(f"/api/admin/import/{import_id}/invite", {"userIds": [str(pat.id)]})
    assert invited.body == {"invited": 1}
    await asyncio.sleep(0.05)  # the mail is queued past COMMIT, on the loop
    mail = [q for q in team["queued"] if q[0] == "send_import_invite"]
    assert len(mail) == 1 and mail[0][1]["to"] == "pat@example.com"
    waiting = (await olga.get(f"/api/admin/import/{import_id}/people")).body["people"]
    assert {p["email"]: p["invited"] for p in waiting} == {
        "bob@example.com": False,
        "pat@example.com": True,
    }
    token = mail[0][1]["url"].split("/join/")[1]

    joined = await sign_up(olga.fork(), "Pat Lee", invite_token=token, email="pat@example.com")
    # The same account, now theirs: active, named as they chose, its history and its
    # private conversations with it.
    assert joined.user_id == str(pat.id)
    now = (await _rows("SELECT * FROM users WHERE id = :id", id=pat.id))[0]
    assert not now.placeholder and now.deactivated_at is None and now.display_name == "Pat Lee"
    mine = {c["name"] for c in (await joined.get("/api/channels")).body["channels"] if c["name"]}
    assert {"general", "launch-plans", "leads"} <= mine
    assert (await joined.get(f"/api/admin/import/{import_id}/people")).status == 403
    people = (await olga.get(f"/api/admin/import/{import_id}/people")).body["people"]
    assert [p["email"] for p in people] == ["bob@example.com"]


async def test_cancelling_stops_it_where_it_is(team: dict[str, Any]) -> None:
    olga: Client = team["olga"]
    import_id = await _uploaded(team)
    started = await olga.post(
        f"/api/admin/import/{import_id}/start", {"includePrivate": False, "copyFiles": False}
    )
    assert started.body["current"]["status"] == "running"
    cancelled = await olga.post(f"/api/admin/import/{import_id}/cancel")
    assert cancelled.body["current"]["status"] == "cancelled"
    await job.step(import_id)
    assert await _rows("SELECT 1 FROM messages WHERE client_msg_id LIKE 'slack:%'") == []
    again = await olga.post(f"/api/admin/import/{import_id}/cancel")
    assert again.status == 409


async def test_a_zip_that_is_not_a_slack_export_fails_with_a_reason(
    team: dict[str, Any], tmp_path: Path
) -> None:
    team["zip"].write_bytes(b"not a zip at all")
    import_id = await _uploaded(team)
    state = (await team["olga"].get("/api/admin/import")).body["current"]
    assert state["id"] == import_id and state["status"] == "failed"
    assert "not a zip" in state["error"]


async def test_only_an_admin_imports(team: dict[str, Any]) -> None:
    member = await invite_and_sign_up(team["olga"], "Max Member")
    refused = await member.post("/api/admin/import", {"sizeBytes": 10})
    assert refused.status == 403
    too_big = await team["olga"].post(
        "/api/admin/import", {"sizeBytes": settings.SLACK_IMPORT_MAX_BYTES + 1}
    )
    assert too_big.status == 400


async def test_a_file_link_is_fetched_only_from_slacks_file_host(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A zip is anybody's to write, and its links carry a token: a link anywhere else is
    # not even resolved, let alone sent the token.
    asked: list[str] = []

    async def pin(url: str) -> None:
        asked.append(url)

    monkeypatch.setattr(job, "pin_public", pin)
    assert await job.fetch("https://evil.example.com/files-pri/x?t=xoxe-1", 100) is None
    assert await job.fetch("http://files.slack.com/files-pri/x?t=xoxe-1", 100) is None
    assert await job.fetch("https://files.slack.com.evil.example/x?t=xoxe-1", 100) is None
    assert asked == []
    assert await job.fetch("https://files.slack.com/files-pri/x?t=xoxe-1", 100) is None
    assert asked == ["https://files.slack.com/files-pri/x?t=xoxe-1"]


async def test_ids_carry_slacks_time_and_are_the_same_every_run() -> None:
    first = history.message_id("ws", "C1", T1)
    assert first == history.message_id("ws", "C1", T1)
    assert first != history.message_id("ws", "C2", T1)
    assert history.message_id("ws", "C1", T1) < history.message_id("ws", "C1", T2)
    assert history.ts_parts("1704103200.000100") == (1704103200000, 100)
    assert history.channel_name("Launch Plans!") == "launch-plans"
    assert history.channel_name("___") == "imported"
