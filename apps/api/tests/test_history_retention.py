"""Retention and legal hold (ADR 0039): what the sweep removes, what it keeps, and who may
set it.

An old message is a row whose UUIDv7 id was minted at an instant in the past, the way an
import would make one; the sweep runs a day and a minute from now, so a window saved in the
test is past its day's wait. Storage is a set of keys, so a refusal can be arranged.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs import retention as retention_job
from blob_api.lib import storage
from blob_api.lib.ids import new_id
from blob_api.realtime import hub
from blob_api.services import retention as retention_service

from .helpers import (
    Client,
    allow_policy,
    invite_and_sign_up,
    send_message,
    sign_up,
    workspace_id_of,
)


def minted(at: datetime) -> str:
    """A UUIDv7 as if minted at `at`."""
    hexed = f"{int(at.timestamp() * 1000):012x}"
    tail = secrets.token_hex(10)
    variant = "89ab"[int(tail[3], 16) % 4]
    return f"{hexed[:8]}-{hexed[8:]}-7{tail[:3]}-{variant}{tail[4:7]}-{tail[7:19]}"


def later() -> datetime:
    """When the sweep runs: past a window's day of waiting from one saved just now."""
    return datetime.now(UTC) + timedelta(days=1, minutes=1)


async def run(*, full: bool = True) -> dict[str, dict[str, int]]:
    return await retention_job.sweep_history(now=later(), full=full)


async def scalar(sql: str, **params: Any) -> Any:
    async with SessionFactory() as session:
        return (await session.execute(text(sql), params)).scalar()


async def execute(sql: str, **params: Any) -> None:
    async with transaction() as (session, _):
        await session.execute(text(sql), params)


@pytest_asyncio.fixture
async def office(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Olga (owner) and Max (member) in #general; #quiet, Olga's alone; a bucket of keys
    and a list of the frames the sweep sent."""
    olga = await sign_up(client, "Olga Owner")
    max_ = await invite_and_sign_up(olga, "Max Member")
    channels = {c["name"]: c["id"] for c in (await olga.get("/api/channels")).body["channels"]}
    general = channels["general"]
    await olga.post(f"/api/channels/{general}/members", {"userIds": [max_.user_id]})
    quiet = (await olga.post("/api/channels", {"name": "quiet", "kind": "public"})).body["channel"][
        "id"
    ]
    workspace_id = await workspace_id_of(olga)

    bucket: set[str] = set()
    refused: set[str] = set()

    async def delete_object(key: str) -> None:
        if key in refused:
            raise RuntimeError("storage said no")
        bucket.discard(key)

    monkeypatch.setattr(storage, "delete_object", delete_object)
    frames: list[tuple[str, dict[str, Any]]] = []
    monkeypatch.setattr(
        hub, "to_channel", lambda channel_id, frame: frames.append((channel_id, frame))
    )

    async def old(
        channel_id: str,
        author: Client,
        body: str,
        *,
        days: int = 120,
        root: str | None = None,
    ) -> str:
        message_id = minted(datetime.now(UTC) - timedelta(days=days))
        await execute(
            """
            INSERT INTO messages (id, workspace_id, channel_id, author_id, body, client_msg_id,
                                  thread_root_id, created_at)
            VALUES (:id, :ws, :channel, :author, :body, :cmid, :root,
                    now() - make_interval(days => :days))
            """,
            id=message_id,
            cmid=f"old-{message_id}",
            ws=workspace_id,
            channel=channel_id,
            author=author.user_id,
            body=body,
            root=root,
            days=days,
        )
        if root is not None:
            await execute(
                "UPDATE messages SET reply_count = reply_count + 1 WHERE id = :id", id=root
            )
        return message_id

    async def attach(message_id: str, author: Client, *, thumb: bool = True) -> str:
        key = f"uploads/{new_id()}"
        thumb_key = f"{key}.thumb" if thumb else None
        await execute(
            """
            INSERT INTO attachments (id, workspace_id, message_id, uploader_id, object_key,
                                     thumb_key, filename, mime, size_bytes)
            VALUES (:id, :ws, :message, :author, :key, :thumb, 'plan.png', 'image/png', 10)
            """,
            id=new_id(),
            ws=workspace_id,
            message=message_id,
            author=author.user_id,
            key=key,
            thumb=thumb_key,
        )
        bucket.update(k for k in (key, thumb_key) if k)
        return key

    async def preview(message_id: str) -> str:
        key = f"previews/{message_id}"
        await execute(
            """
            UPDATE messages SET link_preview = cast(:preview AS jsonb) WHERE id = :id
            """,
            id=message_id,
            preview=(
                '{"url": "https://example.com", "title": "Example", "imageKey": "' + key + '"}'
            ),
        )
        bucket.add(key)
        return key

    return {
        "olga": olga,
        "max": max_,
        "general": general,
        "quiet": quiet,
        "workspace": workspace_id,
        "bucket": bucket,
        "refused": refused,
        "frames": frames,
        "old": old,
        "attach": attach,
        "preview": preview,
    }


async def keep(office: dict[str, Any], **windows: int | None) -> None:
    response = await office["olga"].put(
        "/api/admin/retention",
        {"messageDays": windows.get("messages"), "fileDays": windows.get("files")},
    )
    assert response.status == 200, response.body


async def row(message_id: str) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text(
                    """
                    SELECT body, deleted_at, blocks, link_preview, pinned_at, reply_count,
                           files_removed,
                           (SELECT count(*) FROM attachments WHERE message_id = m.id) AS files,
                           (SELECT count(*) FROM reactions WHERE message_id = m.id) AS reactions
                      FROM messages m WHERE id = :id
                    """
                ),
                {"id": message_id},
            )
        ).fetchone()


# ─── what goes ────────────────────────────────────────────────────────────────


async def test_nothing_is_removed_without_a_window(office: dict[str, Any]) -> None:
    ancient = await office["old"](office["general"], office["olga"], "from long ago", days=4000)

    assert await run() == {}
    assert (await row(ancient)).deleted_at is None


async def test_a_message_past_the_line_becomes_a_tombstone_and_takes_its_traces(
    office: dict[str, Any],
) -> None:
    olga, max_, general = office["olga"], office["max"], office["general"]
    root = await office["old"](general, olga, "the old plan")
    reply = await office["old"](general, max_, "agreed", root=root)
    file_key = await office["attach"](root, olga)
    picture = await office["preview"](root)
    await max_.put(f"/api/messages/{root}/reactions", {"emoji": ":tada:"})
    await execute(
        "UPDATE messages SET pinned_at = now(), pinned_by = :u WHERE id = :id",
        u=olga.user_id,
        id=root,
    )
    await execute(
        "INSERT INTO saved_items (user_id, message_id) VALUES (:u, :m)", u=max_.user_id, m=root
    )
    await execute(
        """
        INSERT INTO message_translations (id, workspace_id, message_id, provider, source_body,
                                          target_language, translated_text)
        VALUES (:id, :ws, :m, 'test', 'the old plan', 'sr', 'stari plan')
        """,
        id=new_id(),
        ws=office["workspace"],
        m=root,
    )
    await execute(
        """
        INSERT INTO thread_summaries (id, workspace_id, channel_id, thread_root_id, overview)
        VALUES (:id, :ws, :c, :m, 'They agreed on the old plan.')
        """,
        id=new_id(),
        ws=office["workspace"],
        c=general,
        m=root,
    )
    fresh = (await send_message(olga, general, "today's news")).body["message"]["id"]
    await keep(office, messages=90)

    outcome = await run()

    assert outcome[office["workspace"]]["messages"] == 2
    assert outcome[office["workspace"]]["files"] == 1
    gone = await row(root)
    assert gone.deleted_at is not None
    assert (gone.body, gone.blocks, gone.link_preview, gone.pinned_at) == ("", None, None, None)
    assert (gone.files, gone.reactions, gone.reply_count) == (0, 0, 0)
    assert (await row(reply)).deleted_at is not None
    assert {file_key, f"{file_key}.thumb", picture} & office["bucket"] == set()
    for table, column in (
        ("message_translations", "message_id"),
        ("thread_summaries", "thread_root_id"),
        ("saved_items", "message_id"),
    ):
        assert await scalar(f"SELECT count(*) FROM {table} WHERE {column} = :m", m=root) == 0
    assert (await row(fresh)).deleted_at is None
    history = await olga.get(f"/api/channels/{general}/messages?limit=100")
    assert [m["id"] for m in history.body["messages"]] == [fresh]
    # One frame for the conversation, naming the newest message the batch took.
    assert (general, {"t": "history.trimmed", "channelId": general, "through": reply}) in office[
        "frames"
    ]
    swept = await scalar(
        "SELECT metadata FROM audit_events WHERE action = 'retention.swept' AND actor_id IS NULL"
    )
    assert swept["messages"] == 2


async def test_a_thread_keeps_its_root_while_a_reply_is_inside_the_window(
    office: dict[str, Any],
) -> None:
    olga, general = office["olga"], office["general"]
    root = await office["old"](general, olga, "an old question")
    answer = await send_message(office["max"], general, "a new answer", threadRootId=root)
    await keep(office, messages=90)

    await run()

    history = await olga.get(f"/api/channels/{general}/messages?limit=100")
    tombstone = next(m for m in history.body["messages"] if m["id"] == root)
    assert tombstone["body"] == "" and tombstone["deletedAt"] is not None
    assert tombstone["replyCount"] == 1
    thread = await olga.get(f"/api/messages/{root}/thread")
    assert [m["id"] for m in thread.body["messages"]] == [root, answer.body["message"]["id"]]


async def test_a_conversation_swept_bare_says_it_has_no_newest_message(
    office: dict[str, Any],
) -> None:
    """The client compares its last loaded row with `lastMessageId`; a pointer naming a row
    history no longer returns would drop every later live message from the open view."""
    olga, quiet = office["olga"], office["quiet"]
    last = await office["old"](quiet, olga, "the last word, long ago")
    await execute("UPDATE channels SET last_message_id = :m WHERE id = :c", m=last, c=quiet)
    await keep(office, messages=90)

    await run()

    channels = (await olga.get("/api/channels")).body["channels"]
    assert next(c for c in channels if c["id"] == quiet)["lastMessageId"] is None
    assert (
        quiet,
        {"t": "history.trimmed", "channelId": quiet, "through": last, "lastMessageId": None},
    ) in office["frames"]


async def test_a_file_storage_refuses_keeps_its_message_until_it_goes(
    office: dict[str, Any],
) -> None:
    """Storage first, rows second: a row is the only record an object exists."""
    olga, general = office["olga"], office["general"]
    message = await office["old"](general, olga, "with a file")
    key = await office["attach"](message, olga)
    office["refused"].add(key)
    await keep(office, messages=90)

    await run()
    stuck = await row(message)
    assert stuck.deleted_at is None and stuck.files == 1

    office["refused"].clear()
    await run(full=False)
    assert (await row(message)).deleted_at is not None
    assert key not in office["bucket"]


async def test_a_file_window_keeps_the_words(office: dict[str, Any]) -> None:
    olga, general = office["olga"], office["general"]
    message = await office["old"](general, olga, "the diagram is attached", days=40)
    key = await office["attach"](message, olga)
    picture = await office["preview"](message)
    await keep(office, files=30)

    outcome = await run()

    kept = await row(message)
    assert kept.deleted_at is None and kept.body == "the diagram is attached"
    assert (kept.files, kept.files_removed) == (0, 1)
    assert kept.link_preview == {"url": "https://example.com", "title": "Example"}
    assert {key, picture} & office["bucket"] == set()
    assert outcome[office["workspace"]]["files"] == 1
    history = await olga.get(f"/api/channels/{general}/messages?limit=100")
    shown = next(m for m in history.body["messages"] if m["id"] == message)
    assert shown["filesRemoved"] == 1 and shown["attachments"] == []


async def test_a_file_never_outlives_its_message(office: dict[str, Any]) -> None:
    """A longer file window than the message window changes nothing: files go with their
    message — and so does what a delete left behind on a message that old."""
    olga, general = office["olga"], office["general"]
    message = await office["old"](general, olga, "fifty days old", days=50)
    await office["attach"](message, olga)
    deleted = await office["old"](general, olga, "deleted, fifty days old", days=50)
    leftover = await office["attach"](deleted, olga, thumb=False)
    await olga.delete(f"/api/messages/{deleted}")
    await keep(office, messages=40, files=365)

    await run()

    assert (await row(message)).deleted_at is not None
    assert leftover not in office["bucket"]


async def test_a_deleted_message_s_files_go_with_the_window(office: dict[str, Any]) -> None:
    """A delete leaves the row's files behind; the window takes them."""
    olga, general = office["olga"], office["general"]
    message = await office["old"](general, olga, "deleted long ago", days=40)
    key = await office["attach"](message, olga, thumb=False)
    await olga.delete(f"/api/messages/{message}")
    await keep(office, files=30)

    await run()

    assert key not in office["bucket"]
    assert await scalar("SELECT count(*) FROM attachments WHERE message_id = :m", m=message) == 0
    assert not [
        f for _, f in office["frames"] if f["t"] == "history.trimmed" and f["through"] == message
    ]


async def test_what_agents_kept_about_old_talk_goes_with_it(
    office: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    from blob_api.config import settings as app_settings

    olga, general = office["olga"], office["general"]
    # Wherever the test runs, the agent's address may resolve privately: allow it.
    monkeypatch.setattr(app_settings, "AGENT_ALLOW_PRIVATE_ENDPOINTS", True)
    await allow_policy(office["workspace"])
    app = await olga.post(
        "/api/admin/plugins",
        {
            "slug": "helper",
            "name": "Helper",
            "runtime": "external",
            "version": "1.0.0",
            "aguiUrl": "https://apps.example.com/agui",
            "events": [],
            "scopes": ["messages:read", "messages:write"],
        },
    )
    assert app.status == 201, app.body
    plugin = app.body["plugin"]["id"]
    ws = office["workspace"]
    old_run, live_run = new_id(), new_id()
    await execute(
        """
        INSERT INTO agent_runs (id, workspace_id, plugin_id, channel_id, transport, status,
                                started_at, chain_id)
        VALUES (:old, :ws, :p, :c, 'http', 'succeeded', now() - interval '100 days', :old),
               (:live, :ws, :p, :c, 'http', 'succeeded', now() - interval '1 day', :live)
        """,
        old=old_run,
        live=live_run,
        ws=ws,
        p=plugin,
        c=general,
    )
    await execute(
        """
        INSERT INTO agent_notes (id, workspace_id, plugin_id, channel_id, body, updated_at)
        VALUES (:id, :ws, :p, :c, 'they like tea', now() - interval '100 days')
        """,
        id=new_id(),
        ws=ws,
        p=plugin,
        c=general,
    )
    await keep(office, messages=90)

    outcome = await run()

    assert await scalar("SELECT count(*) FROM agent_runs WHERE id = :id", id=old_run) == 0
    assert await scalar("SELECT count(*) FROM agent_runs WHERE id = :id", id=live_run) == 1
    assert await scalar("SELECT count(*) FROM agent_notes") == 0
    assert outcome[ws]["agentRuns"] == 1 and outcome[ws]["agentMemory"] == 1


async def test_tasks_and_decisions_outlive_the_talk(office: dict[str, Any]) -> None:
    """Retention removes the talk, never the work."""
    olga, general = office["olga"], office["general"]
    source = await office["old"](general, olga, "we decided to ship on Friday")
    await execute(
        """
        INSERT INTO decisions (id, workspace_id, channel_id, message_id, title, decided_by,
                               client_id)
        VALUES (:id, :ws, :c, :m, 'Ship on Friday', :u, :client)
        """,
        id=new_id(),
        client="decision-1",
        ws=office["workspace"],
        c=general,
        m=source,
        u=olga.user_id,
    )
    await keep(office, messages=90)

    await run()

    assert (await row(source)).deleted_at is not None
    assert await scalar("SELECT title FROM decisions") == "Ship on Friday"


# ─── what a hold keeps ────────────────────────────────────────────────────────


async def test_a_conversation_on_hold_is_skipped(office: dict[str, Any]) -> None:
    olga, general = office["olga"], office["general"]
    held = await office["old"](general, olga, "evidence")
    elsewhere = await office["old"](office["quiet"], olga, "not evidence")
    placed = await olga.put(f"/api/admin/channels/{general}/legal-hold", {"held": True})
    assert placed.status == 200, placed.body
    await keep(office, messages=90)

    await run()

    assert (await row(held)).deleted_at is None
    assert (await row(elsewhere)).deleted_at is not None
    # Its members see it in the conversation's details, and the room heard it placed.
    channels = (await office["max"].get("/api/channels")).body["channels"]
    assert next(c for c in channels if c["id"] == general)["legalHoldAt"] is not None
    told = [f for c, f in office["frames"] if c == general and f["t"] == "channel.updated"]
    assert told and told[0]["channel"]["legalHoldAt"] is not None
    assert "lastReadMessageId" not in told[0]["channel"], "the room's frame carries no one's state"


async def test_a_person_on_hold_keeps_what_they_wrote_and_where_they_are(
    office: dict[str, Any],
) -> None:
    olga, max_, general, quiet = office["olga"], office["max"], office["general"], office["quiet"]
    side = (await olga.post("/api/channels", {"name": "side", "kind": "public"})).body["channel"][
        "id"
    ]
    await max_.post(f"/api/channels/{side}/join", {})
    his = await office["old"](side, max_, "Max wrote this")
    beside_him = await office["old"](general, olga, "said where Max is")
    await olga.post(f"/api/channels/{side}/leave", {})
    away = await office["old"](quiet, olga, "said where Max is not")
    assert (
        await olga.put(f"/api/admin/users/{max_.user_id}/legal-hold", {"held": True})
    ).status == 200
    await max_.post(f"/api/channels/{side}/leave", {})
    await keep(office, messages=90)

    await run()

    assert (await row(his)).deleted_at is None, "what a held person wrote is kept"
    assert (await row(beside_him)).deleted_at is None, "a conversation they are in is kept"
    assert (await row(away)).deleted_at is not None
    # Theirs to know, and nobody else's.
    assert (await max_.get("/api/bootstrap")).body["retention"]["held"] is True
    assert (await olga.get("/api/bootstrap")).body["retention"]["held"] is False


async def test_releasing_a_hold_lets_the_next_sweep_reach_what_it_kept(
    office: dict[str, Any],
) -> None:
    olga, general = office["olga"], office["general"]
    kept = await office["old"](general, olga, "kept for a while")
    await olga.put(f"/api/admin/channels/{general}/legal-hold", {"held": True})
    await keep(office, messages=90)
    await run(full=False)
    assert (await row(kept)).deleted_at is None

    await olga.put(f"/api/admin/channels/{general}/legal-hold", {"held": False})
    await run(full=False)

    assert (await row(kept)).deleted_at is not None


async def test_a_night_that_runs_out_before_a_walk_starts_does_not_count_it_walked(
    office: dict[str, Any],
) -> None:
    """The watermark moves only as far as a walk got. A night whose time ran out before the
    walk began has got nowhere — and recording the line would have skipped everything below
    it until Sunday's full walk."""
    olga, general = office["olga"], office["general"]
    message = await office["old"](general, olga, "still due")
    await keep(office, messages=90)

    await retention_job.sweep_history(now=later(), full=True, budget=timedelta(0))
    assert (await row(message)).deleted_at is None

    await run(full=False)
    assert (await row(message)).deleted_at is not None


# ─── who may, and when ────────────────────────────────────────────────────────


async def test_a_change_waits_a_day(office: dict[str, Any]) -> None:
    olga, general = office["olga"], office["general"]
    message = await office["old"](general, olga, "nearly gone")
    await keep(office, messages=90)

    assert (
        await retention_job.sweep_history(now=datetime.now(UTC) + timedelta(hours=23), full=True)
        == {}
    )
    assert (await row(message)).deleted_at is None
    shown = (await olga.get("/api/admin/retention")).body
    assert shown["messageDays"] == 90 and shown["takesEffectAt"] is not None
    assert shown["nextSweepAt"] > shown["takesEffectAt"]


async def test_saving_the_same_windows_does_not_start_the_wait_again(
    office: dict[str, Any],
) -> None:
    await keep(office, messages=90)
    first = (await office["olga"].get("/api/admin/retention")).body["changedAt"]
    await keep(office, messages=90)
    assert (await office["olga"].get("/api/admin/retention")).body["changedAt"] == first


async def test_windows_are_set_on_their_own_page_by_an_admin_who_signed_in_lately(
    office: dict[str, Any],
) -> None:
    olga, max_ = office["olga"], office["max"]
    sneaked = await olga.patch("/api/admin/settings", {"settings": {"messageRetentionDays": 1}})
    assert sneaked.status == 400
    assert (await max_.put("/api/admin/retention", {"messageDays": 1})).status == 403
    assert (await olga.put("/api/admin/retention", {"messageDays": 0})).status == 400

    await execute(
        "UPDATE sessions SET reauth_at = now() - interval '1 hour' WHERE user_id = :u",
        u=olga.user_id,
    )
    stale = await olga.put("/api/admin/retention", {"messageDays": 30})
    assert stale.status == 403 and stale.body["error"]["code"] == "reauth_required"
    held = await olga.put(f"/api/admin/channels/{office['general']}/legal-hold", {"held": True})
    assert held.body["error"]["code"] == "reauth_required"


async def test_a_change_is_in_the_audit_log_with_before_and_after(office: dict[str, Any]) -> None:
    await keep(office, messages=90, files=30)
    entry = await scalar("SELECT metadata FROM audit_events WHERE action = 'retention.updated'")
    assert entry == {"messages": "forever → 90 days", "files": "forever → 30 days"}


async def test_the_preview_counts_what_the_first_sweep_would_take(office: dict[str, Any]) -> None:
    olga, general = office["olga"], office["general"]
    for n in range(3):
        message = await office["old"](general, olga, f"old {n}")
    await office["attach"](message, olga)
    await office["old"](general, olga, "recent", days=10)

    counted = await olga.get("/api/admin/retention/preview?messageDays=90")
    assert counted.body == {"messages": 3, "files": 1, "capped": False}
    files_only = await olga.get("/api/admin/retention/preview?fileDays=30")
    assert files_only.body == {"messages": 0, "files": 1, "capped": False}


async def test_everyone_is_told_the_windows(office: dict[str, Any]) -> None:
    assert (await office["max"].get("/api/bootstrap")).body["retention"] is None
    await keep(office, messages=365, files=90)
    told = (await office["max"].get("/api/bootstrap")).body["retention"]
    assert told == {"messageDays": 365, "fileDays": 90, "held": False}


def test_the_line_is_the_smallest_id_the_instant_could_mint() -> None:
    at = datetime(2026, 10, 21, 4, 40, tzinfo=UTC)
    line = retention_service.line_id(at)
    assert line == f"{int(at.timestamp() * 1000):012x}"[:8] + line[8:]
    assert minted(at - timedelta(milliseconds=1)) < line <= minted(at)
