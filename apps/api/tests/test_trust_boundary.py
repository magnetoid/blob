"""Four places a member could reach past what they are.

Each of these is small, and each was reachable in production. What they share is that the
check existed somewhere else in the codebase and had not been made here — the app API
resolves channels without the visibility clause the MCP service has and explains, an
avatar is served with a type nobody validated, an assistant token outlives the password
that was supposed to end every session, and the most expensive authenticated route had no
limit at all.
"""

from __future__ import annotations

from typing import Any

import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.rate_limit import LIMITS, Limit

from .helpers import Client, invite_and_sign_up, sign_up


def bot_client(who: Client, token: str) -> Client:
    app = who.fork()
    app._http.headers["authorization"] = f"Bearer {token}"
    return app


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    secret = (await owner.post("/api/channels", {"name": "board-only", "kind": "private"})).body[
        "channel"
    ]["id"]
    return {"owner": owner, "member": member, "general": general, "secret": secret}


class TestABotTokenCannotConfirmAPrivateChannel:
    """Any member can mint one of these for themselves through `POST /api/agents/mine`.

    So "an app may resolve any channel by name" is really "any member may ask whether a
    private channel exists", which is the principle this codebase writes down as
    non-negotiable: private channels answer 404 because their *existence* is private.
    """

    async def test_a_name_it_cannot_see_answers_the_same_as_a_name_that_is_not_there(
        self, team: dict[str, Any]
    ) -> None:
        attached = await team["member"].post("/api/agents/mine", {"name": "Snooper"})
        assert attached.status == 201, attached.body
        app = bot_client(team["member"], attached.body["botToken"])

        real_but_private = await app.post(
            "/api/v1/chat.postMessage", {"channel": "#board-only", "text": "hello"}
        )
        invented = await app.post(
            "/api/v1/chat.postMessage", {"channel": "#no-such-room", "text": "hello"}
        )

        # Identical, or the difference between them is the answer to "does it exist?".
        assert real_but_private.status == invented.status == 404
        assert real_but_private.body == invented.body

    async def test_a_public_channel_still_resolves_by_name(self, team: dict[str, Any]) -> None:
        attached = await team["owner"].post("/api/agents/mine", {"name": "Helper"})
        app = bot_client(team["owner"], attached.body["botToken"])
        await app.post("/api/v1/conversations.join", {"channel": team["general"]})

        posted = await app.post(
            "/api/v1/chat.postMessage", {"channel": "#general", "text": "still works"}
        )
        assert posted.status == 201, posted.body

    async def test_a_private_channel_it_was_added_to_does_resolve(
        self, team: dict[str, Any]
    ) -> None:
        """The clause narrows to what the bot can see — not to public channels only."""
        attached = await team["owner"].post("/api/agents/mine", {"name": "Insider"})
        bot_user_id = attached.body["agent"]["botUserId"]
        added = await team["owner"].post(
            f"/api/channels/{team['secret']}/members", {"userIds": [bot_user_id]}
        )
        assert added.status in (200, 201), added.body

        app = bot_client(team["owner"], attached.body["botToken"])
        posted = await app.post(
            "/api/v1/chat.postMessage", {"channel": "#board-only", "text": "from inside"}
        )
        assert posted.status == 201, posted.body


class TestAnAvatarIsAPicture:
    async def test_a_profile_picture_that_is_markup_is_refused(self, team: dict[str, Any]) -> None:
        """`mime` is whatever the uploader typed; the ticket route checks the extension.

        Accepted, this became an avatar the storage origin served inline as a document to
        everybody in the workspace.
        """
        ticket = await team["member"].post(
            "/api/uploads", {"filename": "me.png", "mime": "text/html", "sizeBytes": 12}
        )
        assert ticket.status == 200, ticket.body

        refused = await team["member"].patch(
            "/api/me", {"avatarAttachmentId": ticket.body["attachmentId"]}
        )
        assert refused.status == 400
        assert "image" in refused.body["error"]["message"]

    async def test_a_real_picture_is_accepted(self, team: dict[str, Any]) -> None:
        ticket = await team["member"].post(
            "/api/uploads", {"filename": "me.png", "mime": "image/png", "sizeBytes": 12}
        )
        accepted = await team["member"].patch(
            "/api/me", {"avatarAttachmentId": ticket.body["attachmentId"]}
        )
        assert accepted.status == 200, accepted.body
        assert accepted.body["user"]["avatarUrl"]

    async def test_the_download_pins_the_type_it_serves(self) -> None:
        """Whatever is stored, the browser is told what this server decided."""
        from urllib.parse import parse_qs, urlparse

        from blob_api.lib.storage import presign_download

        markup = parse_qs(urlparse(presign_download("k", "x.html", "text/html")).query)
        assert markup["response-content-type"] == ["application/octet-stream"]
        assert markup["response-content-disposition"][0].startswith("attachment")

        picture = parse_qs(urlparse(presign_download("k", "x.png", "image/png")).query)
        assert picture["response-content-type"] == ["image/png"]
        assert picture["response-content-disposition"] == ["inline"]


class TestAnAssistantTokenIsASession:
    async def test_a_password_reset_revokes_it(self, team: dict[str, Any]) -> None:
        """Somebody who lost control of their account and reset it was still being read."""
        minted = await team["owner"].post("/api/me/mcp-tokens", {"name": "Laptop"})
        secret = minted.body["secret"]
        assistant = team["owner"].fork()
        assistant._http.headers["authorization"] = f"Bearer {secret}"
        alive = await assistant._http.post(
            "/api/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
            headers={"mcp-protocol-version": "2025-06-18"},
        )
        assert alive.status_code == 200

        async with SessionFactory() as session, session.begin():
            token_row = (
                await session.execute(
                    text(
                        "INSERT INTO password_resets (id, user_id, token_hash, expires_at)"
                        " VALUES (gen_random_uuid(), :user_id, :hash, now() + interval '1 hour')"
                        " RETURNING id"
                    ),
                    {"user_id": team["owner"].user_id, "hash": _hashed("a-reset-token")},
                )
            ).fetchone()
        assert token_row is not None

        used = await team["owner"].post(
            "/api/auth/reset-password", {"token": "a-reset-token", "password": "a-new-one-now"}
        )
        assert used.status == 200, used.body

        after = await assistant._http.post(
            "/api/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
            headers={"mcp-protocol-version": "2025-06-18"},
        )
        assert after.status_code == 401, "the token outlived the password that protected it"

    async def test_signing_out_everywhere_else_revokes_it(self, team: dict[str, Any]) -> None:
        minted = await team["member"].post("/api/me/mcp-tokens", {"name": "Editor"})
        assistant = team["member"].fork()
        assistant._http.headers["authorization"] = f"Bearer {minted.body['secret']}"

        signed_out = await team["member"].post("/api/auth/logout-others")
        assert signed_out.status == 200, signed_out.body

        after = await assistant._http.post(
            "/api/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
            headers={"mcp-protocol-version": "2025-06-18"},
        )
        assert after.status_code == 401, "'everywhere else' has to mean everywhere else"


def _hashed(token: str) -> str:
    from blob_api.lib.auth import hash_token

    return hash_token(token)


class TestCompletingAnUpload:
    async def test_the_second_completion_is_free(self, team: dict[str, Any]) -> None:
        """A retry is a retry. Each repeat used to pay for the whole re-encode again."""
        ticket = await team["owner"].post(
            "/api/uploads", {"filename": "a.png", "mime": "image/png", "sizeBytes": 10}
        )
        attachment_id = ticket.body["attachmentId"]
        first = await team["owner"].post(f"/api/uploads/{attachment_id}/complete", {})
        assert first.status == 200, first.body

        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE attachments SET thumb_key = 'sentinel' WHERE id = :id"),
                {"id": attachment_id},
            )

        second = await team["owner"].post(f"/api/uploads/{attachment_id}/complete", {})
        assert second.status == 200, second.body

        async with SessionFactory() as session:
            still = (
                await session.execute(
                    text("SELECT thumb_key FROM attachments WHERE id = :id"),
                    {"id": attachment_id},
                )
            ).scalar_one()
        assert still == "sentinel", "a completed upload was re-processed"

    async def test_it_is_rate_limited_like_the_ticket_that_made_it(
        self, team: dict[str, Any]
    ) -> None:
        ticket = await team["owner"].post(
            "/api/uploads", {"filename": "b.png", "mime": "image/png", "sizeBytes": 10}
        )
        attachment_id = ticket.body["attachmentId"]

        original = LIMITS["upload"]
        LIMITS["upload"] = Limit(1, 60)
        try:
            # The bucket is already spent by the ticket above in a real flow; here the
            # first completion spends it and the second must be refused.
            await team["owner"].post(f"/api/uploads/{attachment_id}/complete", {})
            refused = await team["owner"].post(f"/api/uploads/{attachment_id}/complete", {})
            assert refused.status == 429, refused.body
        finally:
            LIMITS["upload"] = original
