"""External apps end to end.

The properties worth holding onto, in rough order of how much damage their absence does:

* an app can only reach channels its bot belongs to, checked the same way a person is;
* a delivery is signed, and the signature covers a timestamp so it cannot be replayed;
* registering an app cannot make the server fetch its own network;
* an outbox row and the message it describes commit together;
* an app cannot widen its own permissions by shipping an update.
"""

from __future__ import annotations

import time

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib import net
from blob_api.lib.errors import AppError
from blob_api.plugins import signing
from blob_api.plugins.delivery import BACKOFF_SEC, backoff_for
from blob_api.plugins.manifest import EVENT_SCOPES, EVENTS, SCOPES, Manifest, validate_manifest

from .helpers import Client, invite_and_sign_up, send_message, sign_up

APP = {
    "slug": "standup-bot",
    "name": "Standup Bot",
    "description": "Collects standup notes",
    "runtime": "external",
    "version": "1.0.0",
    "requestUrl": "https://apps.example.com/blob/events",
    "events": ["message.created"],
    "scopes": ["messages:read", "messages:write", "channels:read", "channels:join"],
}


@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    """`apps.example.com` has no DNS record, and the guard refuses names that do not
    resolve — a name nothing can reach is not a name worth fetching.

    Exactly that one hostname is waved through, and nothing else: every case in the SSRF
    tests below uses a literal address, so the real check still runs against all of them
    and the suite does not depend on the network.
    """
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    return {"owner": owner, "member": member, "general": channels[0]["id"]}


async def install(owner: Client, **overrides: object) -> dict:
    payload = {**APP, **overrides}
    response = await owner.post("/api/admin/plugins", payload)
    assert response.status == 201, response.body
    return response.body


def bot_client(owner: Client, token: str) -> Client:
    """A caller with a bot token and no session cookie — how an app really connects."""
    app_client = owner.fork()
    app_client._http.headers["authorization"] = f"Bearer {token}"
    return app_client


# ─── the manifest ─────────────────────────────────────────────────────────────
def test_every_event_maps_to_a_scope_that_exists() -> None:
    # A typo here would let an app subscribe to something nothing can ever authorize.
    assert set(EVENT_SCOPES) == set(EVENTS)
    assert set(EVENT_SCOPES.values()) <= set(SCOPES)


def test_no_presence_or_typing_event_is_offered() -> None:
    # Deliberately absent: they reveal who is at their desk, minute by minute.
    forbidden_prefixes = ("presence.", "typing.", "read_state.")
    for name in EVENTS:
        assert not name.startswith(forbidden_prefixes)


def test_subscribing_needs_the_matching_scope() -> None:
    manifest = Manifest(slug="x-app", name="X", events=["message.created"], scopes=[])
    with pytest.raises(AppError) as excinfo:
        validate_manifest(manifest)
    assert excinfo.value.code == "scope_required"


def test_unknown_scopes_and_events_are_refused() -> None:
    with pytest.raises(AppError) as excinfo:
        validate_manifest(Manifest(slug="x-app", name="X", scopes=["messages:everything"]))
    assert excinfo.value.code == "unknown_scope"
    with pytest.raises(AppError) as excinfo:
        validate_manifest(Manifest(slug="x-app", name="X", events=["user.typed"]))
    assert excinfo.value.code == "unknown_event"


# ─── signing ──────────────────────────────────────────────────────────────────
def test_a_signature_verifies() -> None:
    now = int(time.time())
    body = b'{"event":"message.created"}'
    assert signing.verify("s3cret", str(now), signing.sign("s3cret", now, body), body)


def test_a_signature_does_not_survive_a_changed_body() -> None:
    now = int(time.time())
    signature = signing.sign("s3cret", now, b'{"amount":1}')
    assert not signing.verify("s3cret", str(now), signature, b'{"amount":1000}')


def test_a_captured_request_stops_working() -> None:
    # The timestamp is inside the signed string, so an attacker cannot simply refresh
    # the header on a request they recorded.
    old = int(time.time()) - signing.MAX_SKEW_SEC - 60
    body = b"{}"
    signature = signing.sign("s3cret", old, body)
    assert not signing.verify("s3cret", str(old), signature, body)
    assert not signing.verify("s3cret", str(int(time.time())), signature, body)


def test_the_wrong_secret_does_not_verify() -> None:
    now = int(time.time())
    assert not signing.verify("other", str(now), signing.sign("s3cret", now, b"{}"), b"{}")


@pytest.mark.parametrize("timestamp,signature", [(None, "v0=x"), ("1", None), ("nonsense", "v0=x")])
def test_missing_or_unparseable_headers_are_refused(
    timestamp: str | None, signature: str | None
) -> None:
    assert not signing.verify("s3cret", timestamp, signature, b"{}")


# ─── retries ──────────────────────────────────────────────────────────────────
def test_backoff_grows_and_then_gives_up() -> None:
    delays = [backoff_for(n, jitter=0) for n in range(1, len(BACKOFF_SEC) + 1)]
    assert delays == list(BACKOFF_SEC)
    assert delays == sorted(delays)
    assert backoff_for(len(BACKOFF_SEC) + 1) is None


def test_jitter_stays_inside_its_bound() -> None:
    for _ in range(50):
        delay = backoff_for(1)
        assert delay is not None and 1.0 <= delay <= 1.2


# ─── installing ───────────────────────────────────────────────────────────────
async def test_installing_returns_secrets_exactly_once(team: dict) -> None:
    body = await install(team["owner"])
    assert body["signingSecret"] and body["botToken"].startswith("blob-bot-")
    assert body["plugin"]["status"] == "enabled"

    # Neither secret is readable afterwards, from any endpoint.
    listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
    assert listed[0]["id"] == body["plugin"]["id"]
    assert "signingSecret" not in listed[0]
    assert "botToken" not in listed[0]


async def test_a_member_cannot_install_or_list_apps(team: dict) -> None:
    assert (await team["member"].post("/api/admin/plugins", APP)).status == 403
    assert (await team["member"].get("/api/admin/plugins")).status == 403


async def test_the_bot_is_a_real_user(team: dict) -> None:
    body = await install(team["owner"])
    bot_id = body["plugin"]["botUserId"]
    assert bot_id

    # It shows up as a person would, which is what makes avatars and mentions work.
    users = (await team["owner"].get("/api/bootstrap")).body["users"]
    bot = next(u for u in users if u["id"] == bot_id)
    assert bot["displayName"] == "Standup Bot"

    async with SessionFactory() as session:
        row = (
            await session.execute(
                text("SELECT kind, password_hash, bot_plugin_id FROM users WHERE id = :id"),
                {"id": bot_id},
            )
        ).fetchone()
    assert row is not None
    assert row.kind == "bot"
    # No password: a bot can never sign in through the front door.
    assert row.password_hash is None
    assert row.bot_plugin_id == body["plugin"]["id"]


async def test_a_second_app_cannot_take_the_same_slug(team: dict) -> None:
    await install(team["owner"])
    again = await team["owner"].post("/api/admin/plugins", APP)
    assert again.status == 409
    assert again.body["error"]["code"] == "plugin_exists"


async def test_a_bot_named_after_a_person_still_installs(team: dict) -> None:
    # The display-name index is unique among active users, so this would otherwise be a
    # 500 from a raw constraint violation.
    body = await install(team["owner"], name="Member", slug="member-bot")
    bot_id = body["plugin"]["botUserId"]
    users = (await team["owner"].get("/api/bootstrap")).body["users"]
    assert next(u for u in users if u["id"] == bot_id)["displayName"] == "Member 2"


async def test_installing_is_audited(team: dict) -> None:
    await install(team["owner"])
    events = (await team["owner"].get("/api/admin/audit?action=plugin.installed")).body["events"]
    assert events and events[0]["metadata"]["slug"] == "standup-bot"


# ─── the SSRF guard ───────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "url",
    [
        "http://apps.example.com/hook",  # plain HTTP carries the payload in the clear
        "https://127.0.0.1/hook",
        "https://localhost/hook",
        "https://10.0.0.5/hook",
        "https://192.168.1.1/hook",
        "https://169.254.169.254/latest/meta-data/",  # the cloud metadata endpoint
        "https://[::1]/hook",
        "ftp://apps.example.com/hook",
        "not-a-url",
    ],
)
async def test_a_request_url_pointing_inward_is_refused(team: dict, url: str) -> None:
    response = await team["owner"].post("/api/admin/plugins", {**APP, "requestUrl": url})
    assert response.status == 400, url
    assert response.body["error"]["code"] in {"bad_request_url", "url_required"}


async def test_a_local_plugin_cannot_be_installed_over_http(team: dict) -> None:
    # Installing local code is a deploy, not a console action.
    response = await team["owner"].post(
        "/api/admin/plugins", {**APP, "runtime": "local", "requestUrl": None}
    )
    assert response.status == 400
    assert response.body["error"]["code"] == "local_not_installable"


# ─── the callback API ─────────────────────────────────────────────────────────
async def test_auth_test_reports_what_the_token_can_do(team: dict) -> None:
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])
    response = await app.get("/api/v1/auth.test")
    assert response.status == 200
    assert response.body["slug"] == "standup-bot"
    assert response.body["scopes"] == sorted(APP["scopes"])


@pytest.mark.parametrize("token", ["", "Bearer nonsense", "blob-bot-made-up"])
async def test_a_bad_token_gets_nowhere(team: dict, token: str) -> None:
    await install(team["owner"])
    app = team["owner"].fork()
    if token:
        app._http.headers["authorization"] = token
    assert (await app.get("/api/v1/auth.test")).status == 401


async def test_a_session_cookie_is_not_an_app_token(team: dict) -> None:
    # The two authentication paths are separate on purpose.
    await install(team["owner"])
    assert (await team["owner"].get("/api/v1/auth.test")).status == 401


async def test_an_app_must_join_a_channel_before_posting(team: dict) -> None:
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])

    refused = await app.post(
        "/api/v1/chat.postMessage", {"channel": team["general"], "text": "hello"}
    )
    assert refused.status == 403

    assert (await app.post("/api/v1/conversations.join", {"channel": "#general"})).status == 200
    posted = await app.post(
        "/api/v1/chat.postMessage", {"channel": "#general", "text": "Standup in 5."}
    )
    assert posted.status == 201
    assert posted.body["message"]["kind"] == "bot"


async def test_an_app_cannot_reach_a_private_channel_it_was_not_invited_to(team: dict) -> None:
    private = (
        await team["owner"].post("/api/channels", {"name": "secrets", "kind": "private"})
    ).body["channel"]
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])

    # 404, not 403: a private channel's existence is private, and that has to hold for
    # apps exactly as it does for people.
    assert (await app.post("/api/v1/conversations.join", {"channel": private["id"]})).status == 404
    assert (
        await app.post("/api/v1/chat.postMessage", {"channel": private["id"], "text": "x"})
    ).status == 404
    visible = (await app.get("/api/v1/conversations.list")).body["channels"]
    assert all(channel["id"] != private["id"] for channel in visible)


async def test_a_missing_scope_is_refused_with_a_useful_code(team: dict) -> None:
    body = await install(
        team["owner"],
        slug="reader-bot",
        name="Reader",
        events=[],
        scopes=["channels:read"],
    )
    app = bot_client(team["owner"], body["botToken"])
    response = await app.post("/api/v1/chat.postMessage", {"channel": "#general", "text": "x"})
    assert response.status == 403
    assert response.body["error"]["code"] == "missing_scope"


async def test_an_app_retrying_a_post_does_not_double_it(team: dict) -> None:
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])
    await app.post("/api/v1/conversations.join", {"channel": "#general"})

    payload = {"channel": "#general", "text": "Deploy finished.", "clientMsgId": "build-4711"}
    first = await app.post("/api/v1/chat.postMessage", payload)
    second = await app.post("/api/v1/chat.postMessage", payload)
    assert first.status == 201
    assert second.status == 201
    assert first.body["message"]["id"] == second.body["message"]["id"]


async def test_an_app_cannot_edit_someone_elses_message(team: dict) -> None:
    posted = await send_message(team["owner"], team["general"], "mine")
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])
    await app.post("/api/v1/conversations.join", {"channel": "#general"})

    response = await app.post(
        "/api/v1/chat.update", {"messageId": posted.body["message"]["id"], "text": "changed"}
    )
    assert response.status == 400
    assert response.body["error"]["code"] == "not_own_message"


async def test_a_disabled_app_can_do_nothing(team: dict) -> None:
    body = await install(team["owner"])
    plugin_id = body["plugin"]["id"]
    app = bot_client(team["owner"], body["botToken"])
    await app.post("/api/v1/conversations.join", {"channel": "#general"})

    await team["owner"].post(f"/api/admin/plugins/{plugin_id}/enabled", {"enabled": False})
    assert (await app.get("/api/v1/auth.test")).status == 403
    assert (
        await app.post("/api/v1/chat.postMessage", {"channel": "#general", "text": "x"})
    ).status == 403


async def test_revoking_tokens_locks_an_app_out_immediately(team: dict) -> None:
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])
    assert (await app.get("/api/v1/auth.test")).status == 200

    await team["owner"].delete(f"/api/admin/plugins/{body['plugin']['id']}/tokens")
    assert (await app.get("/api/v1/auth.test")).status == 401


# ─── the outbox ───────────────────────────────────────────────────────────────
async def queued(plugin_id: str) -> list[str]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT event FROM plugin_deliveries WHERE plugin_id = :id ORDER BY id"),
                {"id": plugin_id},
            )
        ).fetchall()
    return [row.event for row in rows]


async def test_a_message_queues_a_delivery(team: dict) -> None:
    body = await install(team["owner"])
    await send_message(team["owner"], team["general"], "hello there")
    assert await queued(body["plugin"]["id"]) == ["message.created"]


async def test_only_subscribed_events_are_queued(team: dict) -> None:
    body = await install(team["owner"])  # subscribes to message.created only
    plugin_id = body["plugin"]["id"]
    posted = await send_message(team["owner"], team["general"], "hello")
    await team["owner"].patch(f"/api/messages/{posted.body['message']['id']}", {"body": "edited"})
    assert await queued(plugin_id) == ["message.created"]


async def test_a_disabled_app_is_not_queued_for(team: dict) -> None:
    body = await install(team["owner"])
    plugin_id = body["plugin"]["id"]
    await team["owner"].post(f"/api/admin/plugins/{plugin_id}/enabled", {"enabled": False})
    await send_message(team["owner"], team["general"], "while disabled")
    assert await queued(plugin_id) == []


async def test_a_rejected_send_queues_nothing(team: dict) -> None:
    """The outbox row and the message commit together, or neither does."""
    body = await install(team["owner"])
    private = (
        await team["owner"].post("/api/channels", {"name": "closed", "kind": "private"})
    ).body["channel"]
    outsider = team["member"]

    refused = await send_message(outsider, private["id"], "should not land")
    assert refused.status == 404
    assert await queued(body["plugin"]["id"]) == []


async def test_an_app_is_not_woken_by_its_own_message(team: dict) -> None:
    # Otherwise an app that posts on message.created answers itself forever.
    body = await install(team["owner"])
    plugin_id = body["plugin"]["id"]
    app = bot_client(team["owner"], body["botToken"])
    await app.post("/api/v1/conversations.join", {"channel": "#general"})
    await app.post("/api/v1/chat.postMessage", {"channel": "#general", "text": "from the app"})
    assert await queued(plugin_id) == []


async def test_two_apps_each_get_their_own_delivery(team: dict) -> None:
    first = await install(team["owner"])
    second = await install(team["owner"], slug="other-bot", name="Other Bot")
    await send_message(team["owner"], team["general"], "broadcast")
    assert await queued(first["plugin"]["id"]) == ["message.created"]
    assert await queued(second["plugin"]["id"]) == ["message.created"]


async def test_deliveries_are_visible_to_an_admin(team: dict) -> None:
    body = await install(team["owner"])
    await send_message(team["owner"], team["general"], "hello")
    response = await team["owner"].get(f"/api/admin/plugins/{body['plugin']['id']}/deliveries")
    assert response.status == 200
    assert response.body["deliveries"][0]["event"] == "message.created"
    assert response.body["deliveries"][0]["status"] == "pending"


async def test_a_pending_delivery_says_when_it_will_be_tried(team: dict) -> None:
    # Without this an admin looking at a stuck queue cannot tell a delivery that is
    # waiting out its backoff from one that is never going to move again.
    body = await install(team["owner"])
    await send_message(team["owner"], team["general"], "hello")
    listed = await team["owner"].get(f"/api/admin/plugins/{body['plugin']['id']}/deliveries")
    assert listed.body["deliveries"][0]["nextAttemptAt"] is not None


async def test_the_delivery_detail_returns_the_payload_the_app_was_sent(team: dict) -> None:
    plugin_id = (await install(team["owner"]))["plugin"]["id"]
    await send_message(team["owner"], team["general"], "hello")
    listed = await team["owner"].get(f"/api/admin/plugins/{plugin_id}/deliveries")
    delivery_id = listed.body["deliveries"][0]["id"]

    detail = await team["owner"].get(f"/api/admin/plugins/{plugin_id}/deliveries/{delivery_id}")
    assert detail.status == 200
    assert detail.body["id"] == delivery_id
    assert detail.body["payload"]["event"] == "message.created"
    assert detail.body["payload"]["payload"]["body"] == "hello"


async def test_a_delivery_belonging_to_another_app_is_not_readable(team: dict) -> None:
    first = (await install(team["owner"]))["plugin"]["id"]
    second = (await install(team["owner"], slug="other-bot", name="Other Bot"))["plugin"]["id"]
    await send_message(team["owner"], team["general"], "hello")
    listed = await team["owner"].get(f"/api/admin/plugins/{first}/deliveries")
    delivery_id = listed.body["deliveries"][0]["id"]

    assert (
        await team["owner"].get(f"/api/admin/plugins/{second}/deliveries/{delivery_id}")
    ).status == 404


async def test_a_member_cannot_read_a_delivery(team: dict) -> None:
    plugin_id = (await install(team["owner"]))["plugin"]["id"]
    await send_message(team["owner"], team["general"], "hello")
    listed = await team["owner"].get(f"/api/admin/plugins/{plugin_id}/deliveries")
    delivery_id = listed.body["deliveries"][0]["id"]

    response = await team["member"].get(f"/api/admin/plugins/{plugin_id}/deliveries/{delivery_id}")
    assert response.status == 403


# ─── updating ─────────────────────────────────────────────────────────────────
async def test_an_update_that_widens_scopes_waits_for_approval(team: dict) -> None:
    body = await install(team["owner"])
    plugin_id = body["plugin"]["id"]
    app = bot_client(team["owner"], body["botToken"])

    updated = await team["owner"].put(
        f"/api/admin/plugins/{plugin_id}",
        {**APP, "version": "2.0.0", "scopes": [*APP["scopes"], "users:manage"]},
    )
    assert updated.status == 200
    assert updated.body["status"] == "needs_review"

    # Until someone approves, the app is inert — the widened grant buys it nothing.
    assert (await app.get("/api/v1/auth.test")).status == 403
    await send_message(team["owner"], team["general"], "while pending")
    assert await queued(plugin_id) == []

    approved = await team["owner"].post(f"/api/admin/plugins/{plugin_id}/approve")
    assert approved.body["status"] == "enabled"
    assert "users:manage" in approved.body["scopes"]
    assert (await app.get("/api/v1/auth.test")).status == 200


async def test_an_update_that_narrows_scopes_takes_effect_at_once(team: dict) -> None:
    body = await install(team["owner"])
    plugin_id = body["plugin"]["id"]
    app = bot_client(team["owner"], body["botToken"])

    narrowed = await team["owner"].put(
        f"/api/admin/plugins/{plugin_id}",
        {**APP, "version": "1.1.0", "scopes": ["messages:read", "channels:read"]},
    )
    assert narrowed.status == 200
    assert narrowed.body["status"] == "enabled"
    assert "messages:write" not in narrowed.body["scopes"]

    response = await app.post("/api/v1/chat.postMessage", {"channel": "#general", "text": "x"})
    assert response.status == 403


async def test_a_slug_cannot_change_after_install(team: dict) -> None:
    body = await install(team["owner"])
    response = await team["owner"].put(
        f"/api/admin/plugins/{body['plugin']['id']}", {**APP, "slug": "something-else"}
    )
    assert response.status == 400
    assert response.body["error"]["code"] == "slug_immutable"


async def test_rotating_the_secret_returns_a_different_one(team: dict) -> None:
    body = await install(team["owner"])
    rotated = await team["owner"].post(f"/api/admin/plugins/{body['plugin']['id']}/secret")
    assert rotated.status == 200
    assert rotated.body["signingSecret"] != body["signingSecret"]


# ─── uninstalling ─────────────────────────────────────────────────────────────
async def test_uninstalling_keeps_what_the_bot_said(team: dict) -> None:
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])
    await app.post("/api/v1/conversations.join", {"channel": "#general"})
    posted = await app.post(
        "/api/v1/chat.postMessage", {"channel": "#general", "text": "Build 4711 passed."}
    )
    message_id = posted.body["message"]["id"]
    bot_id = body["plugin"]["botUserId"]

    assert (await team["owner"].delete(f"/api/admin/plugins/{body['plugin']['id']}")).status == 200

    # The message survives with its author intact — deleting the user would turn a year
    # of CI notifications into messages from nobody.
    history = (await team["owner"].get(f"/api/channels/{team['general']}/messages")).body
    kept = next(m for m in history["messages"] if m["id"] == message_id)
    assert kept["authorId"] == bot_id
    assert kept["body"] == "Build 4711 passed."

    async with SessionFactory() as session:
        row = (
            await session.execute(
                text("SELECT deactivated_at, bot_plugin_id FROM users WHERE id = :id"),
                {"id": bot_id},
            )
        ).fetchone()
    assert row is not None and row.deactivated_at is not None
    assert row.bot_plugin_id is None


async def test_uninstalling_stops_the_token(team: dict) -> None:
    body = await install(team["owner"])
    app = bot_client(team["owner"], body["botToken"])
    await team["owner"].delete(f"/api/admin/plugins/{body['plugin']['id']}")
    assert (await app.get("/api/v1/auth.test")).status == 401


async def test_uninstalling_is_audited(team: dict) -> None:
    body = await install(team["owner"])
    await team["owner"].delete(f"/api/admin/plugins/{body['plugin']['id']}")
    events = (await team["owner"].get("/api/admin/audit?action=plugin.uninstalled")).body["events"]
    assert events and events[0]["metadata"]["slug"] == "standup-bot"


# ─── what an app is allowed to hear ───────────────────────────────────────────
class TestAnAppHearsOnlyWhatItCouldRead:
    """The push side has to agree with the pull side.

    docs/apps.md promises a bot's access is scoped exactly as a person's, and the API
    keeps that promise: a private channel it was not invited to answers 404. The event
    stream did not. Every app subscribed to `message.created` was handed the body of
    every message in the workspace — every private channel, every DM — while the
    endpoint for fetching those same messages refused.
    """

    async def test_a_public_channel_is_heard_without_joining(self, team: dict) -> None:
        # A person can read a public channel without being a member, so a bot can too.
        plugin_id = (await install(team["owner"]))["plugin"]["id"]
        await send_message(team["owner"], team["general"], "public news")
        assert await queued(plugin_id) == ["message.created"]

    async def test_a_private_channel_is_not_heard(self, team: dict) -> None:
        plugin_id = (await install(team["owner"]))["plugin"]["id"]
        private = (
            await team["owner"].post("/api/channels", {"name": "leadership", "kind": "private"})
        ).body["channel"]["id"]

        await send_message(team["owner"], private, "not for apps")

        assert await queued(plugin_id) == []

    async def test_a_private_channel_is_heard_once_the_bot_is_in_it(self, team: dict) -> None:
        body = await install(team["owner"])
        plugin_id = body["plugin"]["id"]
        private = (
            await team["owner"].post("/api/channels", {"name": "invited", "kind": "private"})
        ).body["channel"]["id"]

        # Invited the way a person would be, using the bot's own user row.
        bot_user_id = body["plugin"]["botUserId"]
        await team["owner"].post(f"/api/channels/{private}/members", {"userIds": [bot_user_id]})

        await send_message(team["owner"], private, "now you may hear this")
        assert await queued(plugin_id) == ["message.created"]

    async def test_a_direct_message_is_not_heard(self, team: dict) -> None:
        # The most private thing in the product, and it was going to every app.
        plugin_id = (await install(team["owner"]))["plugin"]["id"]
        dm = (await team["owner"].post("/api/dms", {"userIds": [team["member"].user_id]})).body[
            "channel"
        ]["id"]

        await send_message(team["owner"], dm, "just between us")

        assert await queued(plugin_id) == []


async def test_a_channel_event_without_a_channel_is_refused(team: dict) -> None:
    """The guard that keeps this fixed.

    A channel-scoped event emitted without its channel would deliver to everyone, so it
    raises rather than falling back to the old behaviour.
    """
    from blob_api.db.engine import SessionFactory
    from blob_api.plugins import events as plugin_events

    async with SessionFactory() as session:
        with pytest.raises(ValueError, match="must be emitted with channel_id"):
            await plugin_events.emit(
                session,
                workspace_id="00000000-0000-0000-0000-000000000000",
                event="message.created",
                payload={},
            )


# ─── which channels an app can speak in ───────────────────────────────────────
class TestAppChannels:
    """An installed app is inert until its bot joins a channel.

    Before this there was no way to arrange that from the console at all: the only route
    in was the app calling `conversations.join` for itself, which an app nobody has
    written yet cannot do. So installing an agent produced something that looked
    installed and answered nowhere.
    """

    async def test_public_channels_are_listed_with_membership(self, team: dict) -> None:
        installed = await install(team["owner"])
        plugin_id = installed["plugin"]["id"]

        listed = (await team["owner"].get(f"/api/admin/plugins/{plugin_id}/channels")).body
        assert listed["channels"], "the workspace has a #general to list"
        assert all(not c["joined"] for c in listed["channels"])

    async def test_an_admin_can_put_the_bot_in_a_channel_and_take_it_out(self, team: dict) -> None:
        installed = await install(team["owner"])
        plugin_id = installed["plugin"]["id"]
        general = team["general"]

        assert (
            await team["owner"].post(f"/api/admin/plugins/{plugin_id}/channels/{general}", {})
        ).status == 200
        after_join = (await team["owner"].get(f"/api/admin/plugins/{plugin_id}/channels")).body
        assert [c["joined"] for c in after_join["channels"] if c["id"] == general] == [True]

        assert (
            await team["owner"].delete(f"/api/admin/plugins/{plugin_id}/channels/{general}")
        ).status == 200
        after_leave = (await team["owner"].get(f"/api/admin/plugins/{plugin_id}/channels")).body
        assert [c["joined"] for c in after_leave["channels"] if c["id"] == general] == [False]

    async def test_private_channels_are_not_listed(self, team: dict) -> None:
        # A bot belongs in one only if somebody in it invited the bot. Listing them here
        # would hand an admin a directory of rooms they are not in.
        installed = await install(team["owner"])
        private = (
            await team["owner"].post("/api/channels", {"name": "board-only", "kind": "private"})
        ).body["channel"]

        listed = (
            await team["owner"].get(f"/api/admin/plugins/{installed['plugin']['id']}/channels")
        ).body
        assert private["id"] not in [c["id"] for c in listed["channels"]]

    async def test_a_member_cannot_move_an_app_around(self, team: dict) -> None:
        installed = await install(team["owner"])
        response = await team["member"].post(
            f"/api/admin/plugins/{installed['plugin']['id']}/channels/{team['general']}", {}
        )
        assert response.status == 403
