"""The superadmin console.

The properties worth guarding are mostly negative: who *cannot* do what, and that the
workspace can never be left without an owner.
"""

from __future__ import annotations

import pytest_asyncio

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    admin = await invite_and_sign_up(owner, "Admin", role="admin")
    member = await invite_and_sign_up(owner, "Member")

    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "admin": admin, "member": member, "general": general}


# ─── access ───────────────────────────────────────────────────────────────────
async def test_a_member_cannot_reach_the_admin_api(team: dict) -> None:
    response = await team["member"].get("/api/admin/users")
    # 403, not 401: the client treats 401 as "signed out" and would bounce to login.
    assert response.status == 403
    assert response.body["error"]["code"] == "forbidden"


async def test_an_admin_can_read_the_directory(team: dict) -> None:
    response = await team["admin"].get("/api/admin/users")
    assert response.status == 200
    assert response.body["total"] == 3
    # Admin rows carry email, which the public User shape deliberately omits.
    assert all("email" in u for u in response.body["users"])


async def test_an_invited_admin_really_is_an_admin(team: dict) -> None:
    assert (await team["admin"].get("/api/admin/users")).status == 200


# ─── roles ────────────────────────────────────────────────────────────────────
async def test_only_the_owner_can_change_roles(team: dict) -> None:
    response = await team["admin"].put(
        f"/api/admin/users/{team['member'].user_id}/role", {"role": "admin"}
    )
    assert response.status == 403


async def test_the_owner_can_promote_a_member(team: dict) -> None:
    response = await team["owner"].put(
        f"/api/admin/users/{team['member'].user_id}/role", {"role": "admin"}
    )
    assert response.status == 200
    assert (await team["member"].get("/api/admin/users")).status == 200


async def test_transferring_ownership_demotes_the_previous_owner(team: dict) -> None:
    await team["owner"].put(f"/api/admin/users/{team['admin'].user_id}/role", {"role": "owner"})

    users = (await team["admin"].get("/api/admin/users")).body["users"]
    owners = [u for u in users if u["role"] == "owner"]
    # Exactly one owner, always.
    assert len(owners) == 1
    assert owners[0]["id"] == team["admin"].user_id

    previous = next(u for u in users if u["id"] == team["owner"].user_id)
    assert previous["role"] == "admin"


async def test_the_owner_cannot_change_their_own_role(team: dict) -> None:
    response = await team["owner"].put(
        f"/api/admin/users/{team['owner'].user_id}/role", {"role": "member"}
    )
    assert response.status == 400


async def test_the_owner_cannot_be_deactivated(team: dict) -> None:
    response = await team["admin"].post(f"/api/admin/users/{team['owner'].user_id}/deactivate")
    assert response.status == 400


# ─── deactivation ─────────────────────────────────────────────────────────────
async def test_deactivating_ends_access_immediately(team: dict) -> None:
    assert (
        await team["admin"].post(f"/api/admin/users/{team['member'].user_id}/deactivate")
    ).status == 200
    assert (await team["member"].get("/api/bootstrap")).status == 401


async def test_reactivating_restores_access(team: dict) -> None:
    await team["admin"].post(f"/api/admin/users/{team['member'].user_id}/deactivate")
    assert (
        await team["admin"].post(f"/api/admin/users/{team['member'].user_id}/reactivate")
    ).status == 200

    # The old session was destroyed, but the account works again.
    login = await team["member"].post(
        "/api/auth/login", {"email": "member@example.com", "password": "correct-horse-battery"}
    )
    assert login.status == 200


async def test_revoking_sessions_signs_someone_out_without_disabling_them(team: dict) -> None:
    assert (
        await team["admin"].post(f"/api/admin/users/{team['member'].user_id}/revoke-sessions")
    ).status == 200
    assert (await team["member"].get("/api/bootstrap")).status == 401

    login = await team["member"].post(
        "/api/auth/login", {"email": "member@example.com", "password": "correct-horse-battery"}
    )
    assert login.status == 200


# ─── invitations ──────────────────────────────────────────────────────────────
async def test_invitations_are_visible_and_revocable(team: dict) -> None:
    created = await team["owner"].post("/api/invites", {"email": "new@example.com"})
    assert created.status == 200

    listing = await team["admin"].get("/api/admin/invites")
    pending = [i for i in listing.body["invites"] if i["status"] == "pending"]
    assert any(i["email"] == "new@example.com" for i in pending)

    invite_id = next(i["id"] for i in pending if i["email"] == "new@example.com")
    assert (await team["admin"].delete(f"/api/admin/invites/{invite_id}")).status == 200

    after = await team["admin"].get("/api/admin/invites")
    revoked = next(i for i in after.body["invites"] if i["id"] == invite_id)
    assert revoked["status"] == "revoked"


async def test_an_accepted_invitation_cannot_be_revoked(team: dict) -> None:
    listing = await team["owner"].get("/api/admin/invites")
    accepted = next(i for i in listing.body["invites"] if i["status"] == "accepted")
    assert (await team["owner"].delete(f"/api/admin/invites/{accepted['id']}")).status == 404


# ─── channels ─────────────────────────────────────────────────────────────────
async def test_an_admin_sees_private_channels_they_are_not_in(team: dict) -> None:
    await team["member"].post("/api/channels", {"name": "members-only", "kind": "private"})

    # The ordinary listing hides it…
    ordinary = (await team["admin"].get("/api/channels")).body["channels"]
    assert all(c["name"] != "members-only" for c in ordinary)

    # …but the admin console shows every channel, with counts.
    admin_view = (await team["admin"].get("/api/admin/channels")).body["channels"]
    secret = next(c for c in admin_view if c["name"] == "members-only")
    assert secret["kind"] == "private"
    assert secret["memberCount"] == 1


async def test_an_admin_can_archive_any_channel(team: dict) -> None:
    created = await team["member"].post("/api/channels", {"name": "doomed", "kind": "private"})
    channel_id = created.body["channel"]["id"]

    assert (await team["admin"].post(f"/api/admin/channels/{channel_id}/archive")).status == 200
    blocked = await send_message(team["member"], channel_id, "still here?")
    assert blocked.status == 403


# ─── audit log ────────────────────────────────────────────────────────────────
async def test_every_admin_mutation_writes_an_audit_row(team: dict) -> None:
    await team["owner"].put(f"/api/admin/users/{team['member'].user_id}/role", {"role": "admin"})
    await team["owner"].post(f"/api/admin/users/{team['member'].user_id}/revoke-sessions")

    events = (await team["owner"].get("/api/admin/audit")).body["events"]
    actions = [e["action"] for e in events]
    assert "user.role_changed" in actions
    assert "user.sessions_revoked" in actions

    role_change = next(e for e in events if e["action"] == "user.role_changed")
    assert role_change["actorName"] == "Owner"
    assert role_change["targetLabel"] == "Member"
    assert role_change["metadata"] == {"from": "member", "to": "admin"}


async def test_the_audit_log_filters_by_action(team: dict) -> None:
    await team["owner"].put(f"/api/admin/users/{team['member'].user_id}/role", {"role": "admin"})
    await team["owner"].post(f"/api/admin/users/{team['member'].user_id}/revoke-sessions")

    filtered = await team["owner"].get("/api/admin/audit?action=user.role_changed")
    assert {e["action"] for e in filtered.body["events"]} == {"user.role_changed"}


async def test_a_member_cannot_read_the_audit_log(team: dict) -> None:
    assert (await team["member"].get("/api/admin/audit")).status == 403


# ─── settings and health ──────────────────────────────────────────────────────
async def test_settings_merge_rather_than_replace(team: dict) -> None:
    await team["admin"].patch("/api/admin/settings", {"settings": {"signupPolicy": "invite"}})
    response = await team["admin"].patch(
        "/api/admin/settings", {"settings": {"retentionDays": 365}}
    )
    assert response.body["settings"] == {"signupPolicy": "invite", "retentionDays": 365}


async def test_renaming_the_workspace(team: dict) -> None:
    response = await team["admin"].patch("/api/admin/settings", {"name": "Northwind"})
    assert response.body["name"] == "Northwind"
    assert (await team["member"].get("/api/bootstrap")).body["workspace"]["name"] == "Northwind"


async def test_health_reports_the_datastores(team: dict) -> None:
    response = await team["admin"].get("/api/admin/health")
    assert response.status == 200
    assert response.body["database"] is True
    assert response.body["redis"] is True
    assert response.body["messageCount"] >= 0


# ─── webhooks ─────────────────────────────────────────────────────────────────
async def test_a_webhook_can_be_created_used_and_revoked(team: dict) -> None:
    created = await team["admin"].post(
        "/api/admin/webhooks", {"channelId": team["general"]["id"], "name": "CI"}
    )
    assert created.status == 200
    url = created.body["url"]
    assert url and "/api/hooks/" in url

    # The webhook posts without a session, as a bot.
    token = url.split("/api/hooks/")[1]
    anonymous = team["admin"].fork()
    posted = await anonymous.post(f"/api/hooks/{token}", {"text": "build passed"})
    assert posted.status == 202

    history = await team["admin"].get(f"/api/channels/{team['general']['id']}/messages?limit=5")
    assert any(m["body"] == "build passed" for m in history.body["messages"])

    assert (await team["admin"].delete(f"/api/admin/webhooks/{created.body['id']}")).status == 200
    assert (await anonymous.post(f"/api/hooks/{token}", {"text": "again"})).status == 403


async def test_the_webhook_token_is_shown_once_and_never_again(team: dict) -> None:
    await team["admin"].post(
        "/api/admin/webhooks", {"channelId": team["general"]["id"], "name": "CI"}
    )
    listing = await team["admin"].get("/api/admin/webhooks")
    assert all(w["url"] is None for w in listing.body["webhooks"])


async def test_an_admin_deleting_someone_elses_message_is_audited(team: dict) -> None:
    """Moderation is exactly what the log is for, and it used to leave no trace."""
    sent = await send_message(team["member"], team["general"]["id"], "regrettable")
    message_id = sent.body["message"]["id"]

    assert (await team["admin"].delete(f"/api/messages/{message_id}")).status == 200

    events = (await team["owner"].get("/api/admin/audit?action=message.deleted")).body["events"]
    assert len(events) == 1
    assert events[0]["actorName"] == "Admin"
    assert events[0]["targetId"] == message_id
    assert events[0]["metadata"]["authorId"] == team["member"].user_id


async def test_deleting_your_own_message_is_not_audited(team: dict) -> None:
    # Auditing ordinary use is surveillance, not forensics.
    sent = await send_message(team["member"], team["general"]["id"], "never mind")
    await team["member"].delete(f"/api/messages/{sent.body['message']['id']}")

    events = (await team["owner"].get("/api/admin/audit?action=message.deleted")).body["events"]
    assert events == []


async def test_creating_an_invitation_is_audited(team: dict) -> None:
    # An admin-role invitation is a way to mint an admin; only revocation was logged.
    before = (await team["owner"].get("/api/admin/audit?action=invite.created")).body["events"]
    await team["owner"].post("/api/invites", {"email": "new@example.com", "role": "admin"})

    events = (await team["owner"].get("/api/admin/audit?action=invite.created")).body["events"]
    # The fixture's own two invitations are logged too, which is the point.
    assert len(events) == len(before) + 1
    assert events[0]["metadata"] == {"email": "new@example.com", "role": "admin"}
    assert events[0]["actorName"] == "Owner"
