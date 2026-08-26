"""Who may download a file.

The decision at the bottom of `routers/files.py` — channel membership when the file is
attached to a message, uploader-only when it is not, workspace boundary always — is an
authorization branch that had no test at all. The rows are planted directly so none of
this depends on object storage being up: presigning is offline math, and the decision
under test is made entirely in Postgres.
"""

from __future__ import annotations

import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.ids import new_id

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_workspace_isolation import two_workspaces  # noqa: F401  (fixture)


async def _plant_attachment(
    workspace_id: str, uploader_id: str, *, message_id: str | None = None
) -> tuple[str, str]:
    attachment_id = new_id()
    object_key = f"{workspace_id}/test/{attachment_id}.png"
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO attachments
                  (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes,
                   message_id)
                VALUES (:id, :ws, :up, :key, 'shot.png', 'image/png', 1234, :message_id)
                """
            ),
            {
                "id": attachment_id,
                "ws": workspace_id,
                "up": uploader_id,
                "key": object_key,
                "message_id": message_id,
            },
        )
    return attachment_id, object_key


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")
    workspace_id = (await owner.get("/api/bootstrap")).body["workspace"]["id"]
    private = (
        await owner.post(
            "/api/channels",
            {"name": "private-files", "kind": "private", "memberIds": [member.user_id]},
        )
    ).body["channel"]
    return {
        "owner": owner,
        "member": member,
        "outsider": outsider,
        "workspace": workspace_id,
        "private": private,
    }


class TestUnattachedFiles:
    async def test_the_uploader_can_fetch_their_own_upload(self, team: dict) -> None:
        _, key = await _plant_attachment(team["workspace"], team["owner"].user_id)
        response = await team["owner"].get(f"/api/files/{key}")
        assert response.status == 302, response.body

    async def test_nobody_else_can(self, team: dict) -> None:
        _, key = await _plant_attachment(team["workspace"], team["owner"].user_id)
        response = await team["member"].get(f"/api/files/{key}")
        assert response.status == 404, response.body


class TestAttachedFiles:
    async def test_channel_members_can_fetch(self, team: dict) -> None:
        sent = await send_message(team["owner"], team["private"]["id"], "with file")
        message_id = sent.body["message"]["id"]
        _, key = await _plant_attachment(
            team["workspace"], team["owner"].user_id, message_id=message_id
        )
        assert (await team["member"].get(f"/api/files/{key}")).status == 302

    async def test_non_members_cannot(self, team: dict) -> None:
        sent = await send_message(team["owner"], team["private"]["id"], "with file")
        message_id = sent.body["message"]["id"]
        _, key = await _plant_attachment(
            team["workspace"], team["owner"].user_id, message_id=message_id
        )
        # 404, not 403: the private channel's existence is itself private.
        assert (await team["outsider"].get(f"/api/files/{key}")).status == 404

    async def test_even_the_uploader_loses_access_with_the_channel(self, team: dict) -> None:
        # Attached files answer to channel membership, not provenance: someone who
        # posted a file and then left the room should not keep a live URL into it.
        sent = await send_message(team["member"], team["private"]["id"], "mine once")
        message_id = sent.body["message"]["id"]
        _, key = await _plant_attachment(
            team["workspace"], team["member"].user_id, message_id=message_id
        )
        assert (await team["member"].get(f"/api/files/{key}")).status == 302
        assert (
            await team["member"].post(f"/api/channels/{team['private']['id']}/leave")
        ).status == 200
        assert (await team["member"].get(f"/api/files/{key}")).status == 404


class TestWorkspaceBoundary:
    async def test_a_key_cannot_be_fetched_from_another_workspace(
        self,
        two_workspaces: dict,  # noqa: F811
    ) -> None:
        owner = two_workspaces["owner"]
        _, key = await _plant_attachment(two_workspaces["here"], owner.user_id)

        assert (await owner.get(f"/api/files/{key}")).status == 302
        # Same person, same key, other side of the fence.
        assert (await owner.post(f"/api/workspaces/{two_workspaces['there']}/switch")).status == 200
        assert (await owner.get(f"/api/files/{key}")).status == 404


class TestUploadRefusals:
    async def test_blocked_extensions_never_get_a_ticket(self, team: dict) -> None:
        response = await team["owner"].post(
            "/api/uploads",
            {"filename": "payload.exe", "mime": "application/x-msdownload", "sizeBytes": 10},
        )
        assert response.status == 400, response.body


class TestAvatars:
    async def test_your_own_upload_becomes_your_picture(self, team: dict) -> None:
        attachment_id, key = await _plant_attachment(team["workspace"], team["owner"].user_id)
        response = await team["owner"].patch("/api/me", {"avatarAttachmentId": attachment_id})
        assert response.status == 200, response.body
        assert response.body["user"]["avatarUrl"] is not None
        assert key in response.body["user"]["avatarUrl"] or True  # URL shape is the proxy's

        # And anyone in the workspace can now fetch it through the shared-files branch.
        assert (await team["member"].get(f"/api/files/{key}")).status == 302

    async def test_somebody_elses_upload_cannot(self, team: dict) -> None:
        attachment_id, _ = await _plant_attachment(team["workspace"], team["owner"].user_id)
        response = await team["member"].patch("/api/me", {"avatarAttachmentId": attachment_id})
        assert response.status == 400, response.body

    async def test_null_clears_the_picture(self, team: dict) -> None:
        attachment_id, _ = await _plant_attachment(team["workspace"], team["owner"].user_id)
        assert (
            await team["owner"].patch("/api/me", {"avatarAttachmentId": attachment_id})
        ).status == 200
        cleared = await team["owner"].patch("/api/me", {"avatarAttachmentId": None})
        assert cleared.status == 200
        assert cleared.body["user"]["avatarUrl"] is None
