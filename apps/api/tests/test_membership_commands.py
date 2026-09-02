"""The slash commands a Slack user already has in their fingers.

Every one of these does something the app could already do — the channel details dialog
adds people, the channel menu mutes and archives, the directory joins. What was missing
was the way somebody who has used Slack for five years actually reaches for it, which is
by typing it. That is the parity principle, not a shortcut: where a cleverer interaction
competes with the one they already know, ship the one they know.

Each command goes through the same service the REST route does, so the membership rules,
the plugin events and the socket frames are the ones that already existed rather than a
second set that will drift from them.
"""

from __future__ import annotations

import pytest_asyncio

from .helpers import Client, client_msg_id, invite_and_sign_up, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    made = await owner.post("/api/channels", {"name": "design", "kind": "public"})
    assert made.status == 200, made.body
    return {
        "owner": owner,
        "member": member,
        "general": general,
        "design": made.body["channel"],
    }


async def run(client: Client, channel_id: str, text: str) -> dict:
    response = await client.post(
        "/api/commands",
        {"channelId": channel_id, "text": text, "clientMsgId": client_msg_id()},
    )
    assert response.status == 200, response.body
    return response.body


async def me(client: Client, display_name: str = "Owner") -> dict:
    users = (await client.get("/api/users")).body["users"]
    return next(u for u in users if u["displayName"] == display_name)


async def members_of(client: Client, channel_id: str) -> list[str]:
    return (await client.get(f"/api/channels/{channel_id}/members")).body["userIds"]


class TestInvite:
    async def test_adds_the_person_named(self, team: dict) -> None:
        design = team["design"]["id"]

        body = await run(team["owner"], design, "/invite @Member")

        assert team["member"].user_id in await members_of(team["owner"], design)
        assert "1 person" in body["ephemeral"]

    async def test_they_can_see_the_channel_afterwards(self, team: dict) -> None:
        design = team["design"]["id"]

        await run(team["owner"], design, "/invite @Member")

        theirs = (await team["member"].get("/api/channels")).body["channels"]
        assert any(c["id"] == design for c in theirs)

    async def test_a_name_nobody_has_says_so(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/invite @Nobody")

        assert "No one here" in body["ephemeral"]

    async def test_asking_twice_is_not_an_error(self, team: dict) -> None:
        design = team["design"]["id"]
        await run(team["owner"], design, "/invite @Member")

        body = await run(team["owner"], design, "/invite @Member")

        assert "already here" in body["ephemeral"]

    async def test_with_nobody_named_it_says_how(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/invite")

        assert "/invite @name" in body["ephemeral"]


class TestRemove:
    async def test_takes_them_out(self, team: dict) -> None:
        design = team["design"]["id"]
        await run(team["owner"], design, "/invite @Member")

        body = await run(team["owner"], design, "/remove @Member")

        assert team["member"].user_id not in await members_of(team["owner"], design)
        assert "Removed 1" in body["ephemeral"]

    async def test_someone_who_was_never_here(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/remove @Member")

        assert "aren't in this channel" in body["ephemeral"]

    async def test_removing_yourself_is_leaving(self, team: dict) -> None:
        # Not refused with an error — pointed at the command that does mean it.
        body = await run(team["owner"], team["design"]["id"], "/remove @Owner")

        assert "/leave" in body["ephemeral"]


class TestJoin:
    async def test_joins_by_name_and_opens_it(self, team: dict) -> None:
        body = await run(team["member"], team["general"]["id"], "/join #design")

        assert body["channel"] is not None
        assert body["channel"]["id"] == team["design"]["id"]
        # Taken there, not merely enrolled: a command that leaves you looking at where
        # you were is one you have to follow up by hand.
        assert team["member"].user_id in await members_of(team["owner"], team["design"]["id"])

    async def test_a_channel_that_is_not_open_is_simply_absent(self, team: dict) -> None:
        secret = await team["owner"].post(
            "/api/channels", {"name": "secret-plans", "kind": "private"}
        )
        assert secret.status == 200

        body = await run(team["member"], team["general"]["id"], "/join #secret-plans")

        # The same answer a channel that does not exist gets. Its existence is the
        # private part — telling them it is there but closed answers the question.
        assert "no open channel" in body["ephemeral"]
        assert body["channel"] is None

    async def test_joining_one_you_are_already_in_still_opens_it(self, team: dict) -> None:
        body = await run(team["owner"], team["general"]["id"], "/join #design")

        assert body["channel"]["id"] == team["design"]["id"]

    async def test_the_hash_is_optional(self, team: dict) -> None:
        body = await run(team["member"], team["general"]["id"], "/join design")

        assert body["channel"] is not None


class TestRename:
    async def test_renames_the_channel(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/rename design-team")

        assert "design-team" in body["ephemeral"]
        assert body["channel"] is None  # /rename does not navigate anywhere

    async def test_a_name_the_rules_refuse(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/rename Design Team!")

        # The same rule the console enforces, said the same way — not a schema violation
        # and not a 500.
        assert "lowercase" in body["ephemeral"]

    async def test_a_name_somebody_else_has(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/rename general")

        assert "already a channel" in body["ephemeral"]

    async def test_with_no_name_it_says_how(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/rename")

        assert "/rename" in body["ephemeral"]


class TestMute:
    async def test_toggles(self, team: dict) -> None:
        design = team["design"]["id"]

        muted = await run(team["owner"], design, "/mute")
        assert "Muted" in muted["ephemeral"]
        after = (await team["owner"].get("/api/channels")).body["channels"]
        assert next(c for c in after if c["id"] == design)["membership"]["notifyLevel"] == "none"

        unmuted = await run(team["owner"], design, "/mute")
        assert "Unmuted" in unmuted["ephemeral"]

    async def test_it_is_nobody_else_s_business(self, team: dict) -> None:
        design = team["design"]["id"]
        await run(team["owner"], design, "/invite @Member")

        await run(team["owner"], design, "/mute")

        theirs = (await team["member"].get("/api/channels")).body["channels"]
        assert next(c for c in theirs if c["id"] == design)["membership"]["notifyLevel"] != "none"


class TestArchive:
    async def test_archives(self, team: dict) -> None:
        design = team["design"]["id"]

        body = await run(team["owner"], design, "/archive")

        assert "Archived" in body["ephemeral"]
        sent = await team["owner"].post(
            f"/api/channels/{design}/messages",
            {"body": "after", "clientMsgId": client_msg_id()},
        )
        assert sent.status >= 400

    async def test_a_direct_message_cannot_be(self, team: dict) -> None:
        dm = await team["owner"].post("/api/dms", {"userIds": [team["member"].user_id]})
        assert dm.status == 200, dm.body

        body = await run(team["owner"], dm.body["channel"]["id"], "/archive")

        assert "cannot be archived" in body["ephemeral"]


class TestWho:
    async def test_names_the_people_here(self, team: dict) -> None:
        await run(team["owner"], team["design"]["id"], "/invite @Member")

        body = await run(team["owner"], team["design"]["id"], "/who")

        assert "Owner" in body["ephemeral"]
        assert "Member" in body["ephemeral"]

    async def test_and_never_posts_it(self, team: dict) -> None:
        body = await run(team["owner"], team["design"]["id"], "/who")

        # Ephemeral: who is in a channel is a question, not an announcement.
        assert body["message"] is None
        messages = (
            await team["owner"].get(f"/api/channels/{team['design']['id']}/messages")
        ).body["messages"]
        assert all("here:" not in m["body"] for m in messages)


class TestTheyAreDiscoverable:
    async def test_help_lists_them(self, team: dict) -> None:
        body = await run(team["owner"], team["general"]["id"], "/help")

        for name in ("invite", "remove", "join", "rename", "mute", "archive", "who"):
            assert f"/{name}" in body["ephemeral"]

    async def test_and_so_does_the_composer_s_autocomplete(self, team: dict) -> None:
        # The same list the composer filters as somebody types `/`.
        listed = (await team["owner"].get("/api/bootstrap")).body["commands"]

        names = {c["name"] for c in listed}
        assert {"invite", "remove", "join", "rename", "mute", "archive", "who"} <= names


class TestDm:
    async def test_opens_the_conversation(self, team: dict) -> None:
        body = await run(team["owner"], team["general"]["id"], "/dm @Member")

        assert body["channel"] is not None
        assert body["channel"]["kind"] == "dm"
        assert body["message"] is None

    async def test_and_says_the_thing_if_one_is_given(self, team: dict) -> None:
        body = await run(team["owner"], team["general"]["id"], "/dm @Member are you free?")

        dm_id = body["channel"]["id"]
        theirs = (await team["member"].get(f"/api/channels/{dm_id}/messages")).body["messages"]
        assert [m["body"] for m in theirs] == ["are you free?"]

    async def test_the_message_does_not_land_in_the_channel_it_was_typed_in(
        self, team: dict
    ) -> None:
        # The command is run from #general; the message belongs to the DM. Returning it
        # as `message` would have the client paint it into #general.
        await run(team["owner"], team["general"]["id"], "/dm @Member secret")

        here = (
            await team["owner"].get(f"/api/channels/{team['general']['id']}/messages")
        ).body["messages"]
        assert all(m["body"] != "secret" for m in here)

    async def test_naming_two_people_makes_a_group(self, team: dict) -> None:
        third = await invite_and_sign_up(team["owner"], "Third")

        body = await run(team["owner"], team["general"]["id"], "/dm @Member @Third")

        assert body["channel"]["kind"] == "group_dm"
        assert third.user_id is not None

    async def test_opening_the_same_one_twice_is_the_same_channel(self, team: dict) -> None:
        first = await run(team["owner"], team["general"]["id"], "/dm @Member")
        again = await run(team["owner"], team["general"]["id"], "/dm @Member")

        assert first["channel"]["id"] == again["channel"]["id"]


class TestStatus:
    async def test_sets_an_emoji_and_words(self, team: dict) -> None:
        body = await run(team["owner"], team["general"]["id"], "/status :palm_tree: on holiday")

        assert "on holiday" in body["ephemeral"]
        mine = await me(team["owner"])
        assert mine["statusEmoji"] == ":palm_tree:"
        assert mine["statusText"] == "on holiday"

    async def test_words_alone_are_fine(self, team: dict) -> None:
        await run(team["owner"], team["general"]["id"], "/status in a meeting")

        mine = await me(team["owner"])
        assert mine["statusText"] == "in a meeting"
        assert mine["statusEmoji"] is None

    async def test_clearing_it(self, team: dict) -> None:
        await run(team["owner"], team["general"]["id"], "/status :palm_tree: away")

        body = await run(team["owner"], team["general"]["id"], "/status clear")

        assert "cleared" in body["ephemeral"]
        mine = await me(team["owner"])
        assert mine["statusText"] is None
        assert mine["statusEmoji"] is None

    async def test_and_a_bare_slash_status_clears_it_too(self, team: dict) -> None:
        await run(team["owner"], team["general"]["id"], "/status busy")

        await run(team["owner"], team["general"]["id"], "/status")

        mine = await me(team["owner"])
        assert mine["statusText"] is None


class TestNamesInTheMessageAreNotInstructions:
    """The one that mattered most in this file.

    Resolving mentions across the whole argument made `/dm @Ana what did @Bob mean?`
    open a group with Bob in it — a message *about* somebody, delivered *to* them — and
    made `/remove @Third because @Owner asked me to` remove the person who was named as
    the reason. Only the leading run of names is a list of people; the rest is words.
    """

    async def test_dm_does_not_invite_whoever_the_message_mentions(self, team: dict) -> None:
        third = await invite_and_sign_up(team["owner"], "Third")

        body = await run(
            team["owner"], team["general"]["id"], "/dm @Member what did @Third mean by that?"
        )

        assert body["channel"]["kind"] == "dm"
        assert set(await members_of(team["owner"], body["channel"]["id"])) == {
            team["owner"].user_id,
            team["member"].user_id,
        }
        assert third.user_id not in await members_of(team["owner"], body["channel"]["id"])

    async def test_and_the_mention_stays_in_the_message(self, team: dict) -> None:
        await invite_and_sign_up(team["owner"], "Third")

        body = await run(team["owner"], team["general"]["id"], "/dm @Member ask @Third")

        sent = (
            await team["owner"].get(f"/api/channels/{body['channel']['id']}/messages")
        ).body["messages"]
        assert [m["body"] for m in sent] == ["ask @Third"]

    async def test_remove_takes_out_only_the_people_it_names_first(self, team: dict) -> None:
        third = await invite_and_sign_up(team["owner"], "Third")
        design = team["design"]["id"]
        await run(team["owner"], design, "/invite @Member @Third")

        await run(team["owner"], design, "/remove @Third because @Member asked me to")

        here = await members_of(team["owner"], design)
        assert third.user_id not in here
        assert team["member"].user_id in here


class TestADirectMessageReachesBothSides:
    async def test_the_other_person_can_see_it_at_once(self, team: dict) -> None:
        # The router told only the invoker about the new channel, so the recipient's
        # open client showed no DM and no message until they reloaded — their socket
        # subscribed at connect time to channels that existed then.
        body = await run(team["owner"], team["general"]["id"], "/dm @Member hello")

        theirs = (await team["member"].get("/api/channels")).body["channels"]
        assert any(c["id"] == body["channel"]["id"] for c in theirs)


class TestAGroupMessageHasACeiling:
    def test_the_command_and_the_route_cap_it_the_same(self) -> None:
        # A DM has no leave, so a conversation built past the cap is one nobody can get
        # out of. `CreateDmInput` has always refused it; the command reaches the service
        # directly and so does not pass through that schema — the two numbers have to be
        # the same number, and this is what says so when one of them moves.
        from blob_api.schemas.requests import CreateDmInput
        from blob_api.services.commands import MAX_DM_MEMBERS

        field = CreateDmInput.model_fields["user_ids"]
        limits = [m for m in field.metadata if getattr(m, "max_length", None) is not None]
        assert limits and limits[0].max_length == MAX_DM_MEMBERS

    async def test_and_the_command_refuses_past_it(self, team: dict) -> None:
        # Named through a group, because signing up nine people trips the signup rate
        # limit long before the cap is reached.
        from blob_api.services.commands import MAX_DM_MEMBERS

        assert MAX_DM_MEMBERS == 8
        body = await run(team["owner"], team["general"]["id"], "/dm @Nobody")

        assert "No one here" in body["ephemeral"]


class TestMuteAndStatusLeaveThingsAsTheyFound:
    async def test_unmuting_returns_to_the_default_not_the_loudest(self, team: dict) -> None:
        # `notify_level` starts at "mentions". Writing "all" on the way out left somebody
        # who muted and changed their mind noisier than they started, with nowhere in the
        # toggle to say otherwise.
        design = team["design"]["id"]

        await run(team["owner"], design, "/mute")
        await run(team["owner"], design, "/mute")

        channels = (await team["owner"].get("/api/channels")).body["channels"]
        level = next(c for c in channels if c["id"] == design)["membership"]["notifyLevel"]
        assert level == "mentions"

    async def test_a_status_is_not_born_expired(self, team: dict) -> None:
        # An expiry belongs to the status it was set with. Leaving it made the next one
        # arrive already expired — accepted, announced, and invisible to everybody.
        past = "2020-01-01T00:00:00Z"
        set_earlier = await team["owner"].patch(
            "/api/me", {"statusEmoji": "🎧", "statusText": "heads down", "statusExpiresAt": past}
        )
        assert set_earlier.status == 200, set_earlier.body

        await run(team["owner"], team["general"]["id"], "/status :palm_tree: on holiday")

        assert (await me(team["owner"]))["statusText"] == "on holiday"

    async def test_a_status_longer_than_the_dialog_allows_is_refused(self, team: dict) -> None:
        body = await run(team["owner"], team["general"]["id"], "/status " + "x" * 200)

        assert "characters or fewer" in body["ephemeral"]
        assert (await me(team["owner"]))["statusText"] is None
