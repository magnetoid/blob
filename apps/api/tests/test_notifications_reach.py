"""Whether a notification can leave the server, and whether anybody is told when it cannot.

Both delivery paths fail quietly by design — a dead mail server must not fail the request
that triggered it, and a push service that refuses must not take the notify job down with
it. Quietly is not the same as invisibly, and everything here is about the difference.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.lib import mail, storage, webpush

from .helpers import Client, invite_and_sign_up, sign_up


class _Sub:
    """The duck-typed row `push` takes: id, endpoint and the browser's two keys."""

    def __init__(self, sub_id: str) -> None:
        self.id = sub_id
        self.endpoint = f"https://push.example/{sub_id}"
        self.p256dh = "p"
        self.auth = "a"


class TestPushReportsWhatHappened:
    async def test_a_key_the_library_cannot_use_is_a_failure_not_a_delivery(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The bug this exists for: a bad VAPID key raised something that was not a
        WebPushException, so it was swallowed whole and counted as sent."""

        def explode(**_kwargs: Any) -> None:
            raise ValueError("Invalid private key")

        monkeypatch.setattr("pywebpush.webpush", explode)
        with caplog.at_level("WARNING", logger="blob.lib.webpush"):
            result = await webpush.push([_Sub("s1"), _Sub("s2")], {"title": "x"})

        assert result.delivered == 0
        assert result.failed == 2
        assert result.dead == []
        assert any("could not be sent" in record.message for record in caplog.records)

    async def test_a_subscription_the_browser_threw_away_is_dead_not_failed(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from pywebpush import WebPushException

        class Gone:
            status_code = 410

        def refuse(**kwargs: Any) -> None:
            if kwargs["subscription_info"]["endpoint"].endswith("s1"):
                raise WebPushException("gone", response=Gone())

        monkeypatch.setattr("pywebpush.webpush", refuse)
        result = await webpush.push([_Sub("s1"), _Sub("s2")], {"title": "x"})

        assert result.dead == ["s1"]
        assert result.delivered == 1
        assert result.failed == 0

    async def test_every_push_carries_a_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Without one `pywebpush` waits for ever, on a thread the worker cannot reclaim."""
        seen: list[Any] = []

        def record(**kwargs: Any) -> None:
            seen.append(kwargs.get("timeout"))

        monkeypatch.setattr("pywebpush.webpush", record)
        await webpush.push([_Sub("s1")], {"title": "x"})
        assert seen == [webpush.PUSH_TIMEOUT_SEC]

    async def test_the_old_entrance_still_answers_with_the_dead_ones(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from pywebpush import WebPushException

        class Gone:
            status_code = 404

        def refuse(**_kwargs: Any) -> None:
            raise WebPushException("gone", response=Gone())

        monkeypatch.setattr("pywebpush.webpush", refuse)
        assert await webpush.send_push([_Sub("s1")], {"title": "x"}) == ["s1"]


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    return {"owner": owner, "member": member}


class TestThePushTestButton:
    async def test_it_refuses_when_the_server_has_no_keys(self, team: dict[str, Any]) -> None:
        answer = await team["owner"].post("/api/me/push-test")
        assert answer.status == 400
        assert "push keys" in answer.body["error"]["message"]

    async def test_it_counts_what_landed_and_what_did_not(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", "public")
        monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", "private")

        subscribed = await team["owner"].post(
            "/api/me/push-subscription",
            {
                "endpoint": "https://push.example/one",
                "keys": {"p256dh": "p", "auth": "a"},
            },
        )
        assert subscribed.status == 200, subscribed.body

        def explode(**_kwargs: Any) -> None:
            raise ValueError("Invalid private key")

        monkeypatch.setattr("pywebpush.webpush", explode)
        answer = await team["owner"].post("/api/me/push-test")
        assert answer.status == 200, answer.body
        # The whole point: a broken server key reported as a delivery is the one answer
        # a test button must never give.
        assert answer.body == {"ok": True, "sent": 0, "stale": 0, "failed": 1}

    async def test_nothing_subscribed_is_zero_rather_than_an_error(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", "public")
        monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", "private")
        answer = await team["owner"].post("/api/me/push-test")
        assert answer.status == 200
        assert answer.body["sent"] == 0


class TestMailTellsTheTruth:
    async def test_send_mail_says_when_it_could_not(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(settings, "SMTP_PORT", 9)  # discard; nothing speaks SMTP there
        assert await mail.send_mail("nobody@example.com", "hi", "there") is False

    async def test_the_probe_says_unreachable_rather_than_raising(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(settings, "SMTP_PORT", 9)
        assert await mail.probe() == "unreachable"

        monkeypatch.setattr(settings, "SMTP_HOST", "")
        assert await mail.probe() == "unconfigured"

    async def test_an_invitation_says_whether_the_email_went(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(settings, "SMTP_PORT", 9)

        with_address = await team["owner"].post(
            "/api/invites", {"email": "new@example.com", "role": "member"}
        )
        assert with_address.status == 200, with_address.body
        assert with_address.body["emailed"] is False
        assert with_address.body["url"], "the link is the only copy, so it has to be here"

        # A shareable link was never going to be emailed to anybody.
        link_only = await team["owner"].post("/api/invites", {"role": "member"})
        assert link_only.body["emailed"] is None

    async def test_forgot_password_reports_the_server_not_the_account(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(settings, "SMTP_PORT", 9)

        real = await team["owner"].post("/api/auth/forgot-password", {"email": "owner@example.com"})
        made_up = await team["owner"].post(
            "/api/auth/forgot-password", {"email": "nobody-at-all@example.com"}
        )
        assert real.status == 200 and made_up.status == 200
        # Identical, so the answer still cannot be used to find out who has an account.
        assert real.body == made_up.body == {"ok": True, "mailReachable": False}

    async def test_health_says_whether_either_path_works(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "SMTP_HOST", "127.0.0.1")
        monkeypatch.setattr(settings, "SMTP_PORT", 9)
        monkeypatch.setattr(settings, "VAPID_PUBLIC_KEY", None)
        monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", None)

        health = await team["owner"].get("/api/admin/health")
        assert health.status == 200, health.body
        assert health.body["mail"] == "unreachable"
        assert health.body["push"] is False


class TestTheAdminCanUnlockSomebody:
    async def test_a_reset_link_an_admin_hands_over_works(self, team: dict[str, Any]) -> None:
        made = await team["owner"].post(f"/api/admin/users/{team['member'].user_id}/reset-link")
        assert made.status == 200, made.body
        token = made.body["url"].rsplit("/", 1)[1]
        assert made.body["expiresAt"]

        used = await team["member"].post(
            "/api/auth/reset-password", {"token": token, "password": "a-brand-new-one"}
        )
        assert used.status == 200, used.body

        audit = await team["owner"].get("/api/admin/audit?action=user.reset_link_created")
        assert audit.body["events"][0]["targetId"] == team["member"].user_id

    async def test_a_member_cannot_mint_one(self, team: dict[str, Any]) -> None:
        refused = await team["member"].post(f"/api/admin/users/{team['owner'].user_id}/reset-link")
        assert refused.status == 403

    async def test_somebody_who_is_not_here_is_a_404(self, team: dict[str, Any]) -> None:
        missing = await team["owner"].post(
            "/api/admin/users/01890000-0000-7000-8000-000000000000/reset-link"
        )
        assert missing.status == 404

    async def test_a_deactivated_account_is_not_unlocked_this_way(
        self, team: dict[str, Any]
    ) -> None:
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text("UPDATE users SET deactivated_at = now() WHERE id = :id"),
                {"id": team["member"].user_id},
            )
        refused = await team["owner"].post(f"/api/admin/users/{team['member'].user_id}/reset-link")
        assert refused.status == 404


class TestStorageSaysWhetherABrowserCanReachIt:
    """The third silent path, and the one that fooled two live deployments at once.

    Uploads never touch this server: the browser PUTs straight to the bucket. So every
    check the app already had — "can I open a socket to MinIO?" — was answering a
    different question from the one that matters, and answering it cheerfully while every
    avatar and attachment failed.
    """

    async def test_no_host_to_sign_against_is_named_as_such(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Exactly what one instance had in production: a scheme and nothing after it.
        monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT", "https://")
        assert await storage.probe() == "unconfigured"

    async def test_a_name_only_this_network_knows_is_not_public(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT", "http://minio:9000")
        monkeypatch.setattr(settings, "NODE_ENV", "production")
        assert await storage.probe() == "private"

        # The same shape is correct in development, and must not be reported as broken.
        monkeypatch.setattr(settings, "NODE_ENV", "test")
        monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT", "http://localhost:1")
        assert await storage.probe() == "unreachable"

    async def test_a_proxy_that_cannot_reach_the_bucket_is_unreachable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A 502 is what a bucket published on the wrong container port looks like."""

        class Answer:
            status_code = 502

        class FakeClient:
            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, *_exc: object) -> None:
                return None

            async def get(self, _url: str) -> Answer:
                return Answer()

        monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT", "https://files.example.com")
        monkeypatch.setattr("httpx.AsyncClient", lambda **_kwargs: FakeClient())
        assert await storage.probe() == "unreachable"

    async def test_a_bucket_that_refuses_anonymous_reads_is_still_reachable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        class Answer:
            status_code = 403

        class FakeClient:
            async def __aenter__(self) -> FakeClient:
                return self

            async def __aexit__(self, *_exc: object) -> None:
                return None

            async def get(self, _url: str) -> Answer:
                return Answer()

        monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT", "https://files.example.com")
        monkeypatch.setattr("httpx.AsyncClient", lambda **_kwargs: FakeClient())
        assert await storage.probe() == "ok"

    async def test_health_reports_it(
        self, team: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "S3_PUBLIC_ENDPOINT", "https://")
        health = await team["owner"].get("/api/admin/health")
        assert health.status == 200, health.body
        assert health.body["storage"] == "unconfigured"
