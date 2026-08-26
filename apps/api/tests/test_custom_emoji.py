"""The workspace's own emoji.

Everything about this feature already existed — the table, the bootstrap payload, the
file route, and the picker that renders them. There was simply no way to add one, so the
feature was complete apart from its entrance. These cover the entrance.

The rule worth pinning hardest is the name: it has to be exactly what `:name:` in a
message body can match, or an admin can add an emoji no message is able to reference.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.ids import new_id

from .helpers import Client, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def owner(client: Client) -> Client:
    return await sign_up(client, "Owner")


async def an_upload(owner: Client, mime: str = "image/png") -> str:
    """An attachment row this workspace owns, without touching storage.

    The upload flow is tested where it lives; what matters here is that the emoji
    endpoint accepts an id belonging to the caller and refuses one that does not.
    """
    boot = (await owner.get("/api/bootstrap")).body
    attachment_id = new_id()
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO attachments
                      (id, workspace_id, uploader_id, object_key, filename, mime, size_bytes)
                    VALUES (:id, :ws, :uploader, :key, 'parrot.png', :mime, 1024)
                    """
                ),
                {
                    "id": attachment_id,
                    "ws": boot["workspace"]["id"],
                    "uploader": boot["user"]["id"],
                    "key": f"{boot['workspace']['id']}/parrot-{attachment_id}.png",
                    "mime": mime,
                },
            )
    return attachment_id


class TestAdding:
    async def test_an_emoji_becomes_available_to_everyone(self, owner: Client) -> None:
        added = await owner.post(
            "/api/admin/emoji", {"name": "party-parrot", "attachmentId": await an_upload(owner)}
        )
        assert added.status == 201, added.body
        assert added.body["name"] == "party-parrot"

        # The bootstrap payload is how the picker and `:name:` rendering learn about it,
        # and it has been carrying this field since before anything could fill it.
        member = await invite_and_sign_up(owner, "Member")
        names = [e["name"] for e in (await member.get("/api/bootstrap")).body["customEmoji"]]
        assert "party-parrot" in names

    async def test_the_colons_are_optional_and_the_name_is_lowercased(self, owner: Client) -> None:
        added = await owner.post(
            "/api/admin/emoji", {"name": ":Shipit:", "attachmentId": await an_upload(owner)}
        )
        assert added.status == 201, added.body
        # Somebody typing the shortcode as they would write it should not get `:shipit::`.
        assert added.body["name"] == "shipit"

    @pytest.mark.parametrize("bad", ["a", "no spaces", "Uppercase!", "x" * 33, "emoji:name"])
    async def test_a_name_no_message_could_reference_is_refused(
        self, owner: Client, bad: str
    ) -> None:
        response = await owner.post(
            "/api/admin/emoji", {"name": bad, "attachmentId": await an_upload(owner)}
        )
        # The pattern here is the pattern `markdown.tsx` matches. Accepting anything
        # wider means adding an emoji nobody can type.
        assert response.status == 400, bad

    async def test_a_name_cannot_be_taken_twice(self, owner: Client) -> None:
        assert (
            await owner.post(
                "/api/admin/emoji", {"name": "parrot", "attachmentId": await an_upload(owner)}
            )
        ).status == 201

        second = await owner.post(
            "/api/admin/emoji", {"name": "parrot", "attachmentId": await an_upload(owner)}
        )
        assert second.status == 409
        assert second.body["error"]["code"] == "name_taken"

    async def test_a_non_image_is_refused(self, owner: Client) -> None:
        response = await owner.post(
            "/api/admin/emoji",
            {"name": "sneaky", "attachmentId": await an_upload(owner, mime="application/pdf")},
        )
        assert response.status == 400

    async def test_an_upload_from_somewhere_else_is_not_available(self, owner: Client) -> None:
        other = await invite_and_sign_up(owner, "Member")
        response = await owner.post(
            "/api/admin/emoji", {"name": "borrowed", "attachmentId": await an_upload(other)}
        )
        # 404 rather than 403: whether that id exists at all is not the caller's business.
        assert response.status == 404

    async def test_a_member_cannot_add_one(self, owner: Client) -> None:
        member = await invite_and_sign_up(owner, "Member")
        response = await member.post(
            "/api/admin/emoji", {"name": "nope", "attachmentId": await an_upload(owner)}
        )
        assert response.status == 403


class TestListingAndRemoving:
    async def test_they_are_listed_with_who_added_them(self, owner: Client) -> None:
        await owner.post(
            "/api/admin/emoji", {"name": "parrot", "attachmentId": await an_upload(owner)}
        )
        listed = (await owner.get("/api/admin/emoji")).body["emoji"]
        assert [e["name"] for e in listed] == ["parrot"]
        assert listed[0]["createdByName"] == "Owner"

    async def test_removing_one_frees_the_name(self, owner: Client) -> None:
        await owner.post(
            "/api/admin/emoji", {"name": "parrot", "attachmentId": await an_upload(owner)}
        )
        assert (await owner.delete("/api/admin/emoji/parrot")).status == 200

        # Free again, which is the point of removing rather than hiding.
        assert (
            await owner.post(
                "/api/admin/emoji", {"name": "parrot", "attachmentId": await an_upload(owner)}
            )
        ).status == 201

    async def test_removing_one_that_is_not_there_says_so(self, owner: Client) -> None:
        assert (await owner.delete("/api/admin/emoji/ghost")).status == 404
