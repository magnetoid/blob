"""Channels, messages, threads, reactions and unread state.

Ported from the TypeScript suite, test for test, so a passing run is evidence the port
is faithful rather than merely functional.
"""

from __future__ import annotations

import pytest
import pytest_asyncio

from .helpers import Client, client_msg_id, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    """An owner, a member, an outsider, and the default #general channel."""
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")

    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    return {"owner": owner, "member": member, "outsider": outsider, "general": general}


# ─── bootstrap ────────────────────────────────────────────────────────────────
async def test_bootstrap_returns_the_workspace_and_everyone_in_it(team: dict) -> None:
    boot = await team["owner"].get("/api/bootstrap")
    assert boot.status == 200
    assert boot.body["user"]["role"] == "owner"
    assert len(boot.body["users"]) == 3
    assert boot.body["workspace"]["name"] == "Test Workspace"


async def test_new_users_land_on_the_default_channels(team: dict) -> None:
    channels = (await team["member"].get("/api/channels")).body["channels"]
    joined = {c["name"] for c in channels if c["membership"] is not None}
    assert {"general", "random"} <= joined


# ─── sending ──────────────────────────────────────────────────────────────────
async def test_sending_stores_a_message(team: dict) -> None:
    response = await send_message(team["owner"], team["general"]["id"], "first post")
    assert response.status == 201
    assert response.body["message"]["body"] == "first post"


async def test_sending_is_idempotent_for_a_repeated_client_msg_id(team: dict) -> None:
    same_id = client_msg_id()
    url = f"/api/channels/{team['general']['id']}/messages"

    first = await team["owner"].post(url, {"body": "sent once", "clientMsgId": same_id})
    second = await team["owner"].post(url, {"body": "sent once", "clientMsgId": same_id})

    assert first.status == 201
    # 200, not 201 — nothing new was created.
    assert second.status == 200
    assert second.body["message"]["id"] == first.body["message"]["id"]


async def test_an_empty_message_is_refused(team: dict) -> None:
    response = await team["owner"].post(
        f"/api/channels/{team['general']['id']}/messages",
        {"body": "   ", "clientMsgId": client_msg_id()},
    )
    assert response.status == 400


async def test_mentions_are_resolved_at_write_time(team: dict) -> None:
    response = await send_message(
        team["owner"], team["general"]["id"], f"hey @{team['member'].display_name} look"
    )
    assert response.status == 201
    assert team["member"].user_id in response.body["message"]["mentionUserIds"]


async def test_a_mention_inside_code_pings_nobody(team: dict) -> None:
    response = await send_message(
        team["owner"], team["general"]["id"], f"```\n@{team['member'].display_name}\n```"
    )
    assert response.body["message"]["mentionUserIds"] == []


async def test_history_comes_back_oldest_last(team: dict) -> None:
    for i in range(3):
        await send_message(team["owner"], team["general"]["id"], f"message {i}")

    response = await team["owner"].get(f"/api/channels/{team['general']['id']}/messages?limit=2")
    ids = [m["id"] for m in response.body["messages"]]
    # Ascending order: the client renders straight down the page.
    assert ids == sorted(ids)
    assert len(ids) <= 2


# ─── threads ──────────────────────────────────────────────────────────────────
async def test_a_thread_tracks_its_replies_on_the_root(team: dict) -> None:
    root = await send_message(team["owner"], team["general"]["id"], "thread root")
    root_id = root.body["message"]["id"]

    await send_message(team["member"], team["general"]["id"], "first reply", threadRootId=root_id)
    await send_message(team["member"], team["general"]["id"], "second reply", threadRootId=root_id)

    thread = await team["owner"].get(f"/api/messages/{root_id}/thread")
    assert len(thread.body["messages"]) == 3  # root + 2 replies

    updated_root = thread.body["messages"][0]
    assert updated_root["replyCount"] == 2
    assert team["member"].user_id in updated_root["replyUserIds"]


async def test_thread_replies_stay_out_of_the_channel_timeline(team: dict) -> None:
    before = await team["owner"].get(f"/api/channels/{team['general']['id']}/messages?limit=100")
    root = await send_message(team["owner"], team["general"]["id"], "another root")
    root_id = root.body["message"]["id"]
    await send_message(team["owner"], team["general"]["id"], "hidden reply", threadRootId=root_id)

    after = await team["owner"].get(f"/api/channels/{team['general']['id']}/messages?limit=100")
    # Only the root joined the timeline; the reply lives in the thread.
    assert len(after.body["messages"]) == len(before.body["messages"]) + 1


async def test_replying_subscribes_you_to_the_thread(team: dict) -> None:
    root = await send_message(team["owner"], team["general"]["id"], "root")
    root_id = root.body["message"]["id"]
    await send_message(team["member"], team["general"]["id"], "reply", threadRootId=root_id)

    threads = await team["member"].get("/api/threads")
    assert [m["id"] for m in threads.body["messages"]] == [root_id]


# ─── reactions ────────────────────────────────────────────────────────────────
async def test_reactions_aggregate_and_ignore_duplicates(team: dict) -> None:
    sent = await send_message(team["owner"], team["general"]["id"], "react to me")
    message_id = sent.body["message"]["id"]

    assert (
        await team["owner"].put(f"/api/messages/{message_id}/reactions", {"emoji": ":tada:"})
    ).status == 200
    await team["member"].put(f"/api/messages/{message_id}/reactions", {"emoji": ":tada:"})
    await team["member"].put(f"/api/messages/{message_id}/reactions", {"emoji": ":tada:"})

    thread = await team["owner"].get(f"/api/messages/{message_id}/thread")
    reaction = thread.body["messages"][0]["reactions"][0]
    assert reaction["emoji"] == ":tada:"
    assert len(reaction["userIds"]) == 2

    await team["owner"].delete(f"/api/messages/{message_id}/reactions?emoji=%3Atada%3A")
    after = await team["owner"].get(f"/api/messages/{message_id}/thread")
    assert len(after.body["messages"][0]["reactions"][0]["userIds"]) == 1


# ─── editing and deleting ─────────────────────────────────────────────────────
async def test_you_can_edit_your_own_message_but_not_someone_elses(team: dict) -> None:
    sent = await send_message(team["owner"], team["general"]["id"], "typo herr")
    message_id = sent.body["message"]["id"]

    mine = await team["owner"].patch(f"/api/messages/{message_id}", {"body": "typo here"})
    assert mine.body["message"]["body"] == "typo here"
    assert mine.body["message"]["editedAt"] is not None

    theirs = await team["member"].patch(f"/api/messages/{message_id}", {"body": "nope"})
    assert theirs.status == 403


async def test_deleting_clears_the_body(team: dict) -> None:
    sent = await send_message(team["member"], team["general"]["id"], "delete me")
    message_id = sent.body["message"]["id"]

    assert (await team["member"].delete(f"/api/messages/{message_id}")).status == 200

    history = await team["owner"].get(f"/api/channels/{team['general']['id']}/messages?limit=100")
    found = next((m for m in history.body["messages"] if m["id"] == message_id), None)
    assert found is not None
    assert found["body"] == ""
    assert found["deletedAt"] is not None


async def test_an_admin_can_delete_anyone_s_message(team: dict) -> None:
    sent = await send_message(team["member"], team["general"]["id"], "moderate me")
    message_id = sent.body["message"]["id"]
    assert (await team["owner"].delete(f"/api/messages/{message_id}")).status == 200


async def test_pinning_shows_up_in_the_channel_pins(team: dict) -> None:
    sent = await send_message(team["owner"], team["general"]["id"], "pin me")
    message_id = sent.body["message"]["id"]

    await team["owner"].put(f"/api/messages/{message_id}/pin", {"pinned": True})
    pins = await team["owner"].get(f"/api/channels/{team['general']['id']}/pins")
    assert [m["id"] for m in pins.body["messages"]] == [message_id]


# ─── unread state ─────────────────────────────────────────────────────────────
async def test_a_message_is_unread_for_others_but_not_its_author(team: dict) -> None:
    assert (
        await send_message(team["owner"], team["general"]["id"], "unread trigger")
    ).status == 201

    author_view = (await team["owner"].get("/api/channels")).body["channels"]
    assert next(c for c in author_view if c["id"] == team["general"]["id"])["hasUnread"] is False

    other_view = (await team["member"].get("/api/channels")).body["channels"]
    assert next(c for c in other_view if c["id"] == team["general"]["id"])["hasUnread"] is True


async def test_marking_read_clears_unread(team: dict) -> None:
    await send_message(team["owner"], team["general"]["id"], "read me")
    history = await team["member"].get(f"/api/channels/{team['general']['id']}/messages?limit=1")
    latest = history.body["messages"][-1]

    await team["member"].post(
        f"/api/channels/{team['general']['id']}/read", {"lastReadMessageId": latest["id"]}
    )

    view = (await team["member"].get("/api/channels")).body["channels"]
    assert next(c for c in view if c["id"] == team["general"]["id"])["hasUnread"] is False


async def test_a_late_ack_never_rewinds_the_read_cursor(team: dict) -> None:
    for i in range(3):
        await send_message(team["owner"], team["general"]["id"], f"m{i}")

    history = await team["member"].get(f"/api/channels/{team['general']['id']}/messages?limit=10")
    messages = history.body["messages"]
    older, newest = messages[0], messages[-1]

    url = f"/api/channels/{team['general']['id']}/read"
    await team["member"].post(url, {"lastReadMessageId": newest["id"]})
    late = await team["member"].post(url, {"lastReadMessageId": older["id"]})

    assert late.body["readState"]["lastReadMessageId"] == newest["id"]


# ─── private channels ─────────────────────────────────────────────────────────
@pytest_asyncio.fixture
async def secret(team: dict) -> dict:
    created = await team["owner"].post(
        "/api/channels",
        {"name": "secret-plans", "kind": "private", "memberIds": [team["member"].user_id]},
    )
    channel = created.body["channel"]
    await send_message(team["owner"], channel["id"], "the pineapple flies at midnight")
    return channel


async def test_a_private_channel_is_hidden_from_non_members(team: dict, secret: dict) -> None:
    listing = (await team["outsider"].get("/api/channels")).body["channels"]
    assert all(c["id"] != secret["id"] for c in listing)


async def test_a_private_channel_reports_404_not_403(team: dict, secret: dict) -> None:
    # 404 rather than 403, so the channel's very existence stays private.
    response = await team["outsider"].get(f"/api/channels/{secret['id']}/messages")
    assert response.status == 404


async def test_an_invited_member_can_read_a_private_channel(team: dict, secret: dict) -> None:
    response = await team["member"].get(f"/api/channels/{secret['id']}/messages")
    assert response.status == 200
    assert "pineapple" in response.body["messages"][0]["body"]


# ─── channel lifecycle ────────────────────────────────────────────────────────
async def test_a_duplicate_channel_name_is_refused(team: dict) -> None:
    await team["owner"].post("/api/channels", {"name": "design", "kind": "public"})
    duplicate = await team["owner"].post("/api/channels", {"name": "design", "kind": "public"})
    assert duplicate.status == 409
    assert duplicate.body["error"]["code"] == "channel_exists"


async def test_an_archived_channel_is_read_only(team: dict) -> None:
    created = await team["owner"].post("/api/channels", {"name": "temporary", "kind": "public"})
    channel_id = created.body["channel"]["id"]

    await team["owner"].post(f"/api/channels/{channel_id}/archive")
    blocked = await send_message(team["owner"], channel_id, "still here?")
    assert blocked.status == 403


async def test_joining_and_leaving_a_public_channel(team: dict) -> None:
    created = await team["owner"].post("/api/channels", {"name": "open-house", "kind": "public"})
    channel_id = created.body["channel"]["id"]

    assert (await team["outsider"].post(f"/api/channels/{channel_id}/join")).status == 200
    assert (await send_message(team["outsider"], channel_id, "hello")).status == 201
    assert (await team["outsider"].post(f"/api/channels/{channel_id}/leave")).status == 200


async def test_channel_settings_are_per_user(team: dict) -> None:
    response = await team["member"].patch(
        f"/api/channels/{team['general']['id']}/membership",
        {"notifyLevel": "all", "isStarred": True},
    )
    assert response.body["channel"]["membership"]["notifyLevel"] == "all"
    assert response.body["channel"]["membership"]["isStarred"] is True

    # The owner's own membership is untouched.
    owner_view = (await team["owner"].get("/api/channels")).body["channels"]
    general = next(c for c in owner_view if c["id"] == team["general"]["id"])
    assert general["membership"]["notifyLevel"] == "mentions"


# ─── direct messages ──────────────────────────────────────────────────────────
async def test_opening_a_dm_twice_returns_the_same_channel(team: dict) -> None:
    first = await team["owner"].post("/api/dms", {"userIds": [team["member"].user_id]})
    second = await team["member"].post("/api/dms", {"userIds": [team["owner"].user_id]})

    assert second.body["channel"]["id"] == first.body["channel"]["id"]
    assert first.body["channel"]["kind"] == "dm"


async def test_a_group_dm_is_a_different_channel(team: dict) -> None:
    pair = await team["owner"].post("/api/dms", {"userIds": [team["member"].user_id]})
    trio = await team["owner"].post(
        "/api/dms", {"userIds": [team["member"].user_id, team["outsider"].user_id]}
    )
    assert trio.body["channel"]["id"] != pair.body["channel"]["id"]
    assert trio.body["channel"]["kind"] == "group_dm"


# ─── profile and prefs ────────────────────────────────────────────────────────
async def test_prefs_merge_rather_than_replace(team: dict) -> None:
    await team["owner"].patch("/api/me/prefs", {"theme": "dark"})
    response = await team["owner"].patch("/api/me/prefs", {"density": "compact"})

    assert response.body["prefs"]["theme"] == "dark"
    assert response.body["prefs"]["density"] == "compact"
    assert response.body["prefs"]["enterToSend"] is True


async def test_clearing_a_profile_field_differs_from_omitting_it(team: dict) -> None:
    await team["owner"].patch("/api/me", {"title": "Engineer"})
    assert (await team["owner"].get("/api/bootstrap")).body["user"]["title"] == "Engineer"

    # Omitting the field leaves it alone…
    await team["owner"].patch("/api/me", {"fullName": "Ana Petrov"})
    assert (await team["owner"].get("/api/bootstrap")).body["user"]["title"] == "Engineer"

    # …while sending null clears it.
    await team["owner"].patch("/api/me", {"title": None})
    assert (await team["owner"].get("/api/bootstrap")).body["user"]["title"] is None


# ─── admin ────────────────────────────────────────────────────────────────────
async def test_deactivating_a_user_revokes_their_access(team: dict) -> None:
    response = await team["owner"].post(f"/api/admin/users/{team['outsider'].user_id}/deactivate")
    assert response.status == 200
    assert (await team["outsider"].get("/api/bootstrap")).status == 401


async def test_a_member_cannot_deactivate_anyone(team: dict) -> None:
    response = await team["member"].post(f"/api/admin/users/{team['outsider'].user_id}/deactivate")
    assert response.status == 403


@pytest.mark.parametrize("target", ["owner", "self"])
async def test_the_owner_account_is_protected(team: dict, target: str) -> None:
    response = await team["owner"].post(f"/api/admin/users/{team['owner'].user_id}/deactivate")
    assert response.status == 400
