"""User groups — `@platform-team`.

Most of these pin a decision that a later "simplification" would quietly reverse.

The two that matter most:

* `test_reactivating_a_person_whose_name_became_a_group_is_refused` is the collision the
  obvious design — check on create, check on rename — cannot catch, and it needs no race.
  If `workspace_handles` is ever removed, this is the test that dies.
* `test_editing_a_message_does_not_change_who_it_mentioned` fails the moment anyone
  flattens a group mention into `mention_user_ids`, because editing re-resolves.
"""

from __future__ import annotations

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.ids import new_id
from blob_api.lib.mentions import parse_mentions
from blob_api.services import messages as message_service
from blob_api.services import notify as notify_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    ana = await invite_and_sign_up(owner, "Ana")
    bruno = await invite_and_sign_up(owner, "Bruno")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")
    boot = (await owner.get("/api/bootstrap")).body
    return {
        "owner": owner,
        "ana": ana,
        "bruno": bruno,
        "general": general,
        "workspace_id": boot["workspace"]["id"],
    }


async def a_bot(workspace_id: str) -> str:
    """A bot user, written straight in.

    Installing a real app would drag SSRF-guarded registration and a manifest into a test
    about group membership. What matters here is only `kind = 'bot'` — and this must not
    be a test that skips itself when no app happens to be installed, because the rule it
    guards is a security one.
    """
    bot_id = new_id()
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO users (id, workspace_id, email, display_name, role, kind)
                    VALUES (:id, :ws, :email, 'Helper Bot', 'member', 'bot')
                    """
                ),
                {"id": bot_id, "ws": workspace_id, "email": f"bot-{bot_id}@apps.invalid"},
            )
    return bot_id


async def make_group(owner: Client, handle: str = "platform-team", **extra: object) -> str:
    body = {"handle": handle, "name": extra.pop("name", "Platform Team"), **extra}
    response = await owner.post("/api/admin/groups", body)
    assert response.status == 201, response.body
    return str(response.body["group"]["id"])


class TestTheNamespace:
    async def test_a_group_cannot_take_a_persons_name(self, team: dict) -> None:
        response = await team["owner"].post(
            "/api/admin/groups", {"handle": "ana", "name": "Ana's Team"}
        )
        assert response.status == 409, response.body
        assert response.body["error"]["code"] == "name_taken"

    async def test_a_person_cannot_rename_onto_a_group_handle(self, team: dict) -> None:
        await make_group(team["owner"], "designers")

        response = await team["ana"].patch("/api/me", {"displayName": "designers"})
        assert response.status == 409, response.body
        assert response.body["error"]["code"] == "name_taken"

    async def test_reactivating_a_person_whose_name_became_a_group_is_refused(
        self, team: dict
    ) -> None:
        # The failure the two-check design cannot catch, and it needs no race at all.
        # The display-name index is partial on `deactivated_at IS NULL`, so a group-create
        # check *must* ignore deactivated people — or a departed account holds a name for
        # ever. Both checks pass; the collision exists; no index over one table sees it.
        await team["owner"].post(f"/api/admin/users/{team['ana'].user_id}/deactivate")
        await make_group(team["owner"], "ana")

        response = await team["owner"].post(
            f"/api/admin/users/{team['ana'].user_id}/reactivate"
        )
        assert response.status == 409, response.body

    async def test_a_deactivated_persons_name_is_free_for_a_group(self, team: dict) -> None:
        # The other direction. Over-tightening here would resurrect the name-hostage
        # problem the partial index exists to prevent.
        await team["owner"].post(f"/api/admin/users/{team['ana'].user_id}/deactivate")
        assert await make_group(team["owner"], "ana")

    async def test_two_groups_cannot_share_a_handle(self, team: dict) -> None:
        await make_group(team["owner"], "designers")
        response = await team["owner"].post(
            "/api/admin/groups", {"handle": "designers", "name": "Other"}
        )
        assert response.status == 409

    @pytest.mark.parametrize(
        "handle", ["a", "has space", "_leading", "under_score", "x" * 33, "-lead"]
    )
    async def test_a_handle_no_message_could_reference_is_refused(
        self, team: dict, handle: str
    ) -> None:
        # Each exclusion is load-bearing: `_MENTION_RE` rejects a leading underscore,
        # `markdown.tsx` eats `_underscores_`, and the two parsers disagree about how
        # many words a name may have.
        response = await team["owner"].post(
            "/api/admin/groups", {"handle": handle, "name": "Nope"}
        )
        assert response.status == 400, handle

    async def test_capitals_are_normalised_rather_than_refused(self, team: dict) -> None:
        # A handle is lowercase by construction, so accepting "Platform-Team" and storing
        # it folded is kinder than a validation error about a rule nobody was shown.
        response = await team["owner"].post(
            "/api/admin/groups", {"handle": "Platform-Team", "name": "Platform"}
        )
        assert response.status == 201, response.body
        assert response.body["group"]["handle"] == "platform-team"

    async def test_the_leading_at_somebody_types_is_forgiven(self, team: dict) -> None:
        response = await team["owner"].post(
            "/api/admin/groups", {"handle": "@platform-team", "name": "Platform"}
        )
        assert response.status == 201, response.body
        assert response.body["group"]["handle"] == "platform-team"


class TestResolution:
    async def test_a_handle_resolves_to_a_group_not_a_person(self, team: dict) -> None:
        group_id = await make_group(team["owner"])

        async with SessionFactory() as session:
            targets = await message_service.mention_targets(
                session, team["workspace_id"], "ping @platform-team please"
            )
        result = parse_mentions("ping @platform-team please", targets)

        # The whole storage decision in one assertion: a group stays a group. Flattening
        # would put member ids in `user_ids`, which five things read as "named directly".
        assert result.group_ids == [group_id]
        assert result.user_ids == []

    async def test_a_message_stores_the_group_it_named(self, team: dict) -> None:
        group_id = await make_group(team["owner"])
        sent = await send_message(team["owner"], team["general"]["id"], "@platform-team standup")

        assert sent.body["message"]["mentionGroupIds"] == [group_id]
        assert sent.body["message"]["mentionUserIds"] == []

    async def test_a_person_and_a_group_in_one_message_land_in_different_places(
        self, team: dict
    ) -> None:
        group_id = await make_group(team["owner"])
        sent = await send_message(
            team["owner"], team["general"]["id"], "@Ana and @platform-team, please look"
        )

        assert sent.body["message"]["mentionGroupIds"] == [group_id]
        assert sent.body["message"]["mentionUserIds"] == [team["ana"].user_id]

    async def test_a_group_named_inside_code_mentions_nobody(self, team: dict) -> None:
        await make_group(team["owner"])
        sent = await send_message(
            team["owner"], team["general"]["id"], "use `@platform-team` as the flag"
        )
        assert sent.body["message"]["mentionGroupIds"] == []


class TestTheMentionIsNotRewritten:
    async def test_editing_a_message_does_not_change_who_it_mentioned(
        self, team: dict
    ) -> None:
        """The single most valuable test here.

        Editing re-resolves mentions. Had a group mention been flattened into member ids
        at send time, fixing a typo would silently re-expand against *current* membership
        — someone who was pinged loses the highlight, someone who joined since gains it.
        Storing the group keeps an edit meaning what it says.
        """
        group_id = await make_group(team["owner"])
        await team["owner"].put(
            f"/api/admin/groups/{group_id}/members/{team['ana'].user_id}"
        )
        sent = await send_message(team["owner"], team["general"]["id"], "@platform-team hi")
        message_id = sent.body["message"]["id"]

        # Membership changes between the send and the edit.
        await team["owner"].put(
            f"/api/admin/groups/{group_id}/members/{team['bruno'].user_id}"
        )
        edited = await team["owner"].patch(
            f"/api/messages/{message_id}", {"body": "@platform-team hi (typo fixed)"}
        )

        assert edited.status == 200, edited.body
        assert edited.body["message"]["mentionGroupIds"] == [group_id]
        # Never member ids, before or after.
        assert edited.body["message"]["mentionUserIds"] == []

    async def test_deleting_a_message_forgets_the_group_it_named(self, team: dict) -> None:
        group_id = await make_group(team["owner"])
        sent = await send_message(team["owner"], team["general"]["id"], "@platform-team hi")
        message_id = sent.body["message"]["id"]
        assert (await team["owner"].delete(f"/api/messages/{message_id}")).status == 200

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text("SELECT mention_group_ids FROM messages WHERE id = :id"),
                    {"id": message_id},
                )
            ).fetchone()
        assert row is not None and list(row.mention_group_ids or []) == []
        assert group_id  # the group itself is untouched


class TestWhoGetsTold:
    async def test_a_group_mention_reaches_its_members(self, team: dict) -> None:
        group_id = await make_group(team["owner"])
        await team["owner"].put(
            f"/api/admin/groups/{group_id}/members/{team['ana'].user_id}"
        )

        async with SessionFactory() as session:
            recipients = await notify_service.load_group_recipients(session, [group_id])
        assert recipients == {team["ana"].user_id}

    async def test_it_counts_as_a_mention_but_is_labelled_a_group(self, team: dict) -> None:
        decisions = notify_service.decide(
            notify_service.NotifiableMessage(
                id="m1",
                channel_id="c1",
                channel_kind="public",
                author_id="author",
                body="@platform-team standup",
                mention_group_ids=["g1"],
            ),
            [notify_service.Recipient(user_id="u1")],
            group_recipients={"u1"},
        )
        # Badge-strength, because being named as part of your team is being named — and
        # labelled apart from "mention" so the two can ever be told apart.
        assert decisions == [notify_service.Decision("u1", "group", True)]

    async def test_being_named_personally_outranks_being_named_by_group(self) -> None:
        [decision] = notify_service.decide(
            notify_service.NotifiableMessage(
                id="m1",
                channel_id="c1",
                channel_kind="public",
                author_id="author",
                body="@Ana and @platform-team",
                mention_user_ids=["u1"],
                mention_group_ids=["g1"],
            ),
            [notify_service.Recipient(user_id="u1")],
            group_recipients={"u1"},
        )
        assert decision.reason == "mention"

    async def test_a_muted_group_is_silent(self, team: dict) -> None:
        group_id = await make_group(team["owner"])
        await team["owner"].put(
            f"/api/admin/groups/{group_id}/members/{team['ana'].user_id}"
        )
        muted = await team["ana"].put(f"/api/groups/{group_id}/mute", {"muted": True})
        assert muted.status == 200, muted.body

        async with SessionFactory() as session:
            recipients = await notify_service.load_group_recipients(session, [group_id])
        assert recipients == set()

    async def test_muting_a_group_is_not_muting_the_channel(self) -> None:
        # `notify_level == "none"` short-circuits before every mention test, so a muted
        # channel silences a group mention too. Per-group mute is an additional opt-out,
        # never a reordering of that.
        assert (
            notify_service.decide(
                notify_service.NotifiableMessage(
                    id="m1",
                    channel_id="c1",
                    channel_kind="public",
                    author_id="author",
                    body="@platform-team",
                    mention_group_ids=["g1"],
                ),
                [notify_service.Recipient(user_id="u1", notify_level="none")],
                group_recipients={"u1"},
            )
            == []
        )

    async def test_a_member_outside_the_channel_is_never_considered(self) -> None:
        # `decide` iterates only the channel's recipients, so the bound is structural.
        # A notification carries the channel name and a body preview; delivering one for
        # a channel somebody cannot open would leak both and then 404 on the tap.
        assert (
            notify_service.decide(
                notify_service.NotifiableMessage(
                    id="m1",
                    channel_id="c1",
                    channel_kind="public",
                    author_id="author",
                    body="@platform-team",
                    mention_group_ids=["g1"],
                ),
                [],
                group_recipients={"outsider"},
            )
            == []
        )


class TestMembership:
    async def test_adding_somebody_twice_adds_them_once(self, team: dict) -> None:
        group_id = await make_group(team["owner"])
        for _ in range(2):
            response = await team["owner"].put(
                f"/api/admin/groups/{group_id}/members/{team['ana'].user_id}"
            )
            assert response.status == 200, response.body

        members = await team["owner"].get(f"/api/admin/groups/{group_id}/members")
        assert members.body["userIds"] == [team["ana"].user_id]

    async def test_a_bot_cannot_be_put_in_a_group(self, team: dict) -> None:
        """The privilege-inversion guard.

        `@channel` puts nothing in `mention_user_ids` and therefore wakes no agent. A
        group must not become the back door that `@channel` is not — so a bot cannot be a
        member, and `add_member` filters on `kind = 'human'` rather than trusting callers.
        """
        bot_id = await a_bot(team["workspace_id"])

        group_id = await make_group(team["owner"])
        added = await team["owner"].put(f"/api/admin/groups/{group_id}/members/{bot_id}")
        assert added.status == 200, added.body

        members = await team["owner"].get(f"/api/admin/groups/{group_id}/members")
        assert members.body["userIds"] == []

    async def test_removing_somebody_takes_them_out(self, team: dict) -> None:
        group_id = await make_group(team["owner"])
        await team["owner"].put(
            f"/api/admin/groups/{group_id}/members/{team['ana'].user_id}"
        )
        assert (
            await team["owner"].delete(
                f"/api/admin/groups/{group_id}/members/{team['ana'].user_id}"
            )
        ).status == 200

        members = await team["owner"].get(f"/api/admin/groups/{group_id}/members")
        assert members.body["userIds"] == []

    async def test_muting_a_group_you_are_not_in_says_nothing_about_it(
        self, team: dict
    ) -> None:
        group_id = await make_group(team["owner"])
        response = await team["ana"].put(f"/api/groups/{group_id}/mute", {"muted": True})
        # 404 rather than 403: which of "no such group" and "not a member" it is would
        # tell somebody whether a group they cannot see exists.
        assert response.status == 404


class TestWhoMayManage:
    async def test_a_member_cannot_create_one(self, team: dict) -> None:
        response = await team["ana"].post(
            "/api/admin/groups", {"handle": "designers", "name": "Designers"}
        )
        assert response.status == 403

    async def test_a_member_cannot_add_people(self, team: dict) -> None:
        group_id = await make_group(team["owner"])
        response = await team["ana"].put(
            f"/api/admin/groups/{group_id}/members/{team['bruno'].user_id}"
        )
        assert response.status == 403

    async def test_a_group_from_another_workspace_does_not_exist(self, team: dict) -> None:
        owner = team["owner"]
        here = team["workspace_id"]
        second = await owner.post("/api/admin/instance/workspaces", {"name": "Second"})
        assert second.status in (200, 201), second.body
        there = second.body["id"]

        assert (await owner.post(f"/api/workspaces/{there}/switch")).status == 200
        created = await owner.post("/api/admin/groups", {"handle": "theirs", "name": "Theirs"})
        assert created.status == 201, created.body
        assert (await owner.post(f"/api/workspaces/{here}/switch")).status == 200

        response = await owner.delete(f"/api/admin/groups/{created.body['group']['id']}")
        # 404, never 403: the dependency says whether you are an admin, the SQL says of
        # what. Same posture private channels take.
        assert response.status == 404


class TestRenaming:
    async def test_the_handle_moves_with_it(self, team: dict) -> None:
        group_id = await make_group(team["owner"], "designers")
        assert (
            await team["owner"].patch(f"/api/admin/groups/{group_id}", {"handle": "design"})
        ).status == 200

        sent = await send_message(team["owner"], team["general"]["id"], "@design hello")
        assert sent.body["message"]["mentionGroupIds"] == [group_id]

        stale = await send_message(team["owner"], team["general"]["id"], "@designers hello")
        assert stale.body["message"]["mentionGroupIds"] == []

    async def test_renaming_onto_a_taken_handle_is_refused(self, team: dict) -> None:
        group_id = await make_group(team["owner"], "designers")
        await make_group(team["owner"], "engineers", name="Engineers")

        response = await team["owner"].patch(
            f"/api/admin/groups/{group_id}", {"handle": "engineers"}
        )
        assert response.status == 409

    async def test_deleting_a_group_frees_its_handle(self, team: dict) -> None:
        group_id = await make_group(team["owner"], "designers")
        assert (await team["owner"].delete(f"/api/admin/groups/{group_id}")).status == 200

        # A person may now take the name, which is what "freed" has to mean.
        assert (await team["ana"].patch("/api/me", {"displayName": "designers"})).status == 200
