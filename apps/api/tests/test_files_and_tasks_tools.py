"""`read_file` and `list_tasks`: two reads for a person's assistant and an agent alike.

Both obey the rules every read here keeps: the person's own access is the floor, an
agent's room is the ceiling, a private channel the reader cannot see is never named, and
a deleted message takes its files with it. Storage is stubbed — the bytes are not the
point; who may reach them is.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.errors import AppError
from blob_api.lib.ids import new_id
from blob_api.services import mcp as mcp_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_mcp import Mcp, mint

NOTES = "# Launch\n\n- ship 1.11\n- write the notes\n"


@pytest_asyncio.fixture
async def office(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    private = (
        await owner.post(
            "/api/channels", {"name": "war-room", "kind": "private", "memberIds": [member.user_id]}
        )
    ).body["channel"]["id"]

    stored: dict[str, bytes] = {}

    async def head(key: str, n: int = 64) -> bytes:
        return stored[key][:n]

    monkeypatch.setattr(mcp_service, "get_object_head", head)
    return {
        "owner": owner,
        "member": member,
        "outsider": outsider,
        "general": general,
        "private": private,
        "stored": stored,
    }


async def attach(office: dict[str, Any], channel: str, files: list[tuple[str, str, bytes]]) -> str:
    """A message in `channel` carrying `files` (name, mime, bytes). Answers its id."""
    sent = await send_message(office["owner"], channel, "the files")
    message_id = sent.body["message"]["id"]
    async with SessionFactory() as session, session.begin():
        workspace_id = (
            await session.execute(
                text("SELECT workspace_id FROM channels WHERE id = :id"), {"id": channel}
            )
        ).scalar_one()
        for name, mime, data in files:
            key = f"{workspace_id}/{new_id()}-{name}"
            office["stored"][key] = data
            await session.execute(
                text(
                    """
                    INSERT INTO attachments
                      (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes,
                       kind, message_id, uploaded_at)
                    VALUES (:id, :ws, :up, :key, :name, :mime, :size, 'file', :msg, now())
                    """
                ),
                {
                    "id": new_id(),
                    "ws": workspace_id,
                    "up": office["owner"].user_id,
                    "key": key,
                    "name": name,
                    "mime": mime,
                    "size": len(data),
                    "msg": message_id,
                },
            )
    return str(message_id)


class TestReadFile:
    async def test_a_text_file_is_read_by_someone_who_can_see_it(
        self, office: dict[str, Any]
    ) -> None:
        message_id = await attach(
            office, office["general"], [("notes.md", "text/markdown", NOTES.encode())]
        )
        mcp = Mcp(office["member"], await mint(office["member"]))
        read = await mcp.call("read_file", {"message_id": message_id})
        assert read.startswith("notes.md — ")
        assert "- ship 1.11" in read

    async def test_an_outsider_gets_nothing_about_a_private_channel(
        self, office: dict[str, Any]
    ) -> None:
        message_id = await attach(
            office, office["private"], [("plan.txt", "text/plain", b"secret plan")]
        )
        mcp = Mcp(office["outsider"], await mint(office["outsider"]))
        refused = await mcp.refuse("read_file", {"message_id": message_id})
        assert "secret plan" not in refused
        assert "war-room" not in refused

    async def test_a_deleted_message_takes_its_files_with_it(self, office: dict[str, Any]) -> None:
        message_id = await attach(
            office, office["general"], [("notes.md", "text/markdown", NOTES.encode())]
        )
        deleted = await office["owner"].delete(f"/api/messages/{message_id}")
        assert deleted.status == 200, deleted.body
        mcp = Mcp(office["member"], await mint(office["member"]))
        assert "no message" in await mcp.refuse("read_file", {"message_id": message_id})

    async def test_several_files_are_chosen_by_name(self, office: dict[str, Any]) -> None:
        message_id = await attach(
            office,
            office["general"],
            [("a.csv", "text/csv", b"x,y\n1,2\n"), ("b.json", "application/json", b'{"k": 1}')],
        )
        mcp = Mcp(office["member"], await mint(office["member"]))
        asked = await mcp.refuse("read_file", {"message_id": message_id})
        assert "a.csv" in asked and "b.json" in asked
        assert '{"k": 1}' in await mcp.call(
            "read_file", {"message_id": message_id, "name": "B.JSON"}
        )

    async def test_a_binary_file_is_not_read_as_text(self, office: dict[str, Any]) -> None:
        message_id = await attach(
            office, office["general"], [("shot.png", "image/png", b"\x89PNG\r\n")]
        )
        mcp = Mcp(office["member"], await mint(office["member"]))
        assert "only text files" in await mcp.refuse("read_file", {"message_id": message_id})

    async def test_a_file_that_lied_about_its_size_is_refused(self, office: dict[str, Any]) -> None:
        big = b"x" * (mcp_service.READ_FILE_MAX_BYTES + 10)
        message_id = await attach(office, office["general"], [("dump.txt", "text/plain", big)])
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE attachments SET size_bytes = 10 WHERE message_id = :id"),
                {"id": message_id},
            )
        mcp = Mcp(office["member"], await mint(office["member"]))
        assert "too long" in await mcp.refuse("read_file", {"message_id": message_id})

    async def test_an_agent_in_general_cannot_read_a_private_rooms_file(
        self, office: dict[str, Any]
    ) -> None:
        """The member can open it themselves; an agent answering them in #general cannot,
        because the answer would land where the war room's members are not all reading."""
        message_id = await attach(
            office, office["private"], [("plan.txt", "text/plain", b"secret plan")]
        )
        room_bound = await agent_caller(office, office["member"], room=office["general"])
        with pytest.raises(AppError) as refused:
            await mcp_service.call(room_bound, "read_file", {"message_id": message_id})
        assert refused.value.status_code == 404
        assert "secret plan" not in refused.value.message

        in_the_room = await agent_caller(office, office["member"], room=office["private"])
        assert "secret plan" in await mcp_service.call(
            in_the_room, "read_file", {"message_id": message_id}
        )


async def agent_caller(
    office: dict[str, Any], person: Client, *, room: str | None
) -> mcp_service.McpCaller:
    from blob_api.jobs import agui_tools

    async with SessionFactory() as session:
        workspace_id = (
            await session.execute(
                text("SELECT workspace_id FROM users WHERE id = :id"), {"id": person.user_id}
            )
        ).scalar_one()
    caller = await agui_tools.caller_for(
        workspace_id=str(workspace_id), person_id=person.user_id, room_channel_id=room
    )
    assert caller is not None
    return caller


async def task_in(office: dict[str, Any], channel: str, title: str, **extra: Any) -> dict[str, Any]:
    root = await send_message(office["owner"], channel, f"About {title}")
    made = await office["owner"].post(
        f"/api/threads/{root.body['message']['id']}/tasks", {"title": title, **extra}
    )
    assert made.status == 201, made.body
    return dict(made.body["task"])


class TestListTasks:
    async def test_the_tasks_a_person_can_see_with_owner_and_status(
        self, office: dict[str, Any]
    ) -> None:
        await task_in(
            office, office["general"], "Write the notes", assigneeUserId=office["member"].user_id
        )
        await task_in(office, office["private"], "Plan the offsite")
        mcp = Mcp(office["member"], await mint(office["member"]))
        listed = await mcp.call("list_tasks")
        assert "Write the notes" in listed and "Member" in listed and "#general" in listed
        assert "Plan the offsite" in listed  # the member is in the war room

    async def test_a_private_channels_tasks_are_never_named_to_an_outsider(
        self, office: dict[str, Any]
    ) -> None:
        await task_in(office, office["private"], "Plan the offsite")
        mcp = Mcp(office["outsider"], await mint(office["outsider"]))
        listed = await mcp.call("list_tasks")
        assert "offsite" not in listed and "war-room" not in listed

    async def test_mine_and_status_narrow_it(self, office: dict[str, Any]) -> None:
        await task_in(office, office["general"], "Mine", assigneeUserId=office["member"].user_id)
        await task_in(office, office["general"], "Theirs", assigneeUserId=office["owner"].user_id)
        mcp = Mcp(office["member"], await mint(office["member"]))
        mine = await mcp.call("list_tasks", {"mine": True})
        assert "Mine" in mine and "Theirs" not in mine
        assert await mcp.call("list_tasks", {"status": "done"}) == "No tasks match."
        assert "is one of" in await mcp.refuse("list_tasks", {"status": "someday"})

    async def test_an_agent_answering_in_general_sees_no_private_rooms_tasks(
        self, office: dict[str, Any]
    ) -> None:
        await task_in(office, office["general"], "Write the notes")
        await task_in(office, office["private"], "Plan the offsite")
        room_bound = await agent_caller(office, office["member"], room=office["general"])
        listed = await mcp_service.call(room_bound, "list_tasks", {})
        assert "Write the notes" in listed
        assert "offsite" not in listed and "war-room" not in listed
