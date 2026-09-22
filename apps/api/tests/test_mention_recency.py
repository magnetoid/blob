"""Whom you tagged last, for the `@` picker — `services/mention_recency.py`.

The picker's first row is what Enter takes, so the order it offers decides who gets a
notification. Recency is what puts the person you meant in that row before you have
typed their name, the way Slack's picker does. It is read off the messages you actually
wrote rather than kept as a record of its own, so there is nothing to drift from them
and nothing about whom you talk to that outlives deleting what you said.

Read through `/api/bootstrap`, because the client is the contract: the lists are only
useful under the names the client reads.
"""

from __future__ import annotations

from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.lib.ids import new_id
from blob_api.services.mention_recency import KEEP, SCAN_LIMIT

from .helpers import Client, invite_and_sign_up, send_message, sign_up

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Recency Owner")
    ana = await invite_and_sign_up(owner, "Ana")
    bruno = await invite_and_sign_up(owner, "Bruno")
    cleo = await invite_and_sign_up(owner, "Cleo")
    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")["id"]
    await owner.post(
        f"/api/channels/{general}/members",
        {"userIds": [ana.user_id, bruno.user_id, cleo.user_id]},
    )
    boot = (await owner.get("/api/bootstrap")).body
    return {
        "owner": owner,
        "ana": ana,
        "bruno": bruno,
        "cleo": cleo,
        "general": general,
        "workspace_id": boot["workspace"]["id"],
    }


async def recent(who: Client) -> tuple[list[str], list[str]]:
    boot = (await who.get("/api/bootstrap")).body
    return boot["recentMentionUserIds"], boot["recentMentionGroupIds"]


async def tag(who: Client, channel_id: str, body: str) -> str:
    sent = await send_message(who, channel_id, body)
    assert sent.status == 201, sent.body
    return str(sent.body["message"]["id"])


async def make_group(owner: Client, handle: str) -> str:
    response = await owner.post("/api/admin/groups", {"handle": handle, "name": handle.title()})
    assert response.status == 201, response.body
    return str(response.body["group"]["id"])


# ─── rows written straight in ────────────────────────────────────────────────
#
# For the cases that need more people, or more messages, than the API will make in a
# test: signups and sends are rate limited, and neither limit is what is under test.


async def insert_people(workspace_id: str, count: int) -> list[str]:
    ids = [new_id() for _ in range(count)]
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO users (id, workspace_id, email, display_name)
                SELECT t.id, :ws, 'person-' || t.n || '@example.com', 'Person ' || t.n
                  FROM unnest(cast(:ids AS uuid[])) WITH ORDINALITY AS t(id, n)
                """
            ),
            {"ws": workspace_id, "ids": ids},
        )
    return ids


async def insert_groups(workspace_id: str, count: int) -> list[str]:
    ids = [new_id() for _ in range(count)]
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO user_groups (id, workspace_id, handle, name)
                SELECT t.id, :ws, 'group-' || t.n, 'Group ' || t.n
                  FROM unnest(cast(:ids AS uuid[])) WITH ORDINALITY AS t(id, n)
                """
            ),
            {"ws": workspace_id, "ids": ids},
        )
    return ids


async def insert_message(
    team: dict[str, Any],
    message_id: str,
    *,
    users: list[str] | None = None,
    groups: list[str] | None = None,
    deleted: bool = False,
) -> None:
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO messages (id, workspace_id, channel_id, author_id, body,
                                      client_msg_id, mention_user_ids, mention_group_ids,
                                      deleted_at)
                VALUES (:id, :ws, :channel, :author, 'seeded', :client,
                        cast(:users AS uuid[]), cast(:groups AS uuid[]),
                        CASE WHEN :deleted THEN now() END)
                """
            ),
            {
                "id": message_id,
                "ws": team["workspace_id"],
                "channel": team["general"],
                "author": team["owner"].user_id,
                "client": f"seeded-{message_id}",
                "users": users or [],
                "groups": groups or [],
                "deleted": deleted,
            },
        )


async def insert_plain_messages(team: dict[str, Any], ids: list[str]) -> None:
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text(
                """
                INSERT INTO messages (id, workspace_id, channel_id, author_id, body,
                                      client_msg_id)
                SELECT t.id, :ws, :channel, :author, 'filler', 'filler-' || t.id
                  FROM unnest(cast(:ids AS uuid[])) AS t(id)
                """
            ),
            {
                "ids": ids,
                "ws": team["workspace_id"],
                "channel": team["general"],
                "author": team["owner"].user_id,
            },
        )


def ascending_ids(count: int) -> list[str]:
    """Message ids in the order they are to be read as written: UUIDv7 sorts by time."""
    return sorted(new_id() for _ in range(count))


async def another_workspace() -> str:
    workspace_id = new_id()
    async with SessionFactory() as session, session.begin():
        await session.execute(
            text("INSERT INTO workspaces (id, name, slug) VALUES (:id, 'Elsewhere', :slug)"),
            {"id": workspace_id, "slug": f"elsewhere-{workspace_id[:8]}"},
        )
    return workspace_id


class TestTheOrder:
    async def test_the_person_tagged_last_comes_first(self, team: dict[str, Any]) -> None:
        for name in ("Ana", "Bruno", "Cleo"):
            await tag(team["owner"], team["general"], f"@{name} can you take a look?")

        users, _ = await recent(team["owner"])

        assert users == [team["cleo"].user_id, team["bruno"].user_id, team["ana"].user_id]

    async def test_tagging_someone_again_moves_them_up_rather_than_listing_them_twice(
        self, team: dict[str, Any]
    ) -> None:
        for name in ("Ana", "Bruno", "Ana"):
            await tag(team["owner"], team["general"], f"@{name} ping")

        users, _ = await recent(team["owner"])

        assert users == [team["ana"].user_id, team["bruno"].user_id]

    async def test_two_people_in_one_message_keep_the_order_they_were_written_in(
        self, team: dict[str, Any]
    ) -> None:
        # One message is one moment, so the tie is broken by where each name sits in it
        # — the same rule the client applies when your own message arrives.
        await tag(team["owner"], team["general"], "@Ana first")
        await tag(team["owner"], team["general"], "@Cleo and @Bruno, together")

        users, _ = await recent(team["owner"])

        assert users == [team["cleo"].user_id, team["bruno"].user_id, team["ana"].user_id]

    async def test_somebody_who_has_tagged_nobody_gets_two_empty_lists(
        self, team: dict[str, Any]
    ) -> None:
        await tag(team["owner"], team["general"], "Morning, everyone.")

        assert await recent(team["owner"]) == ([], [])


class TestWhoCounts:
    async def test_you_are_never_in_your_own_list(self, team: dict[str, Any]) -> None:
        await tag(team["owner"], team["general"], "@Recency Owner note to self, and @Ana")

        users, _ = await recent(team["owner"])

        assert users == [team["ana"].user_id]

    async def test_only_what_you_wrote_counts(self, team: dict[str, Any]) -> None:
        # Ana tagging Bruno says nothing about whom the owner talks to.
        await tag(team["ana"], team["general"], "@Bruno hello")

        assert (await recent(team["owner"]))[0] == []
        assert (await recent(team["ana"]))[0] == [team["bruno"].user_id]

    async def test_a_deleted_message_tags_nobody(self, team: dict[str, Any]) -> None:
        await tag(team["owner"], team["general"], "@Ana hello")
        oops = await tag(team["owner"], team["general"], "@Bruno wrong person")
        assert (await team["owner"].delete(f"/api/messages/{oops}")).status == 200

        users, _ = await recent(team["owner"])

        assert users == [team["ana"].user_id]

    async def test_even_a_deleted_row_that_still_names_people(self, team: dict[str, Any]) -> None:
        # The delete route clears the arrays as well, so the test above would pass on
        # that alone. This is the row it did not clear: the rule is "deleted", not
        # "happens to have empty arrays".
        await tag(team["owner"], team["general"], "@Ana hello")
        await insert_message(team, new_id(), users=[team["bruno"].user_id], deleted=True)

        users, _ = await recent(team["owner"])

        assert users == [team["ana"].user_id]

    async def test_somebody_deactivated_since_is_not_offered(self, team: dict[str, Any]) -> None:
        # The picker would drop them anyway; kept here, they would hold one of the thirty
        # places for a name that can no longer be mentioned.
        await tag(team["owner"], team["general"], "@Ana hello")
        await tag(team["owner"], team["general"], "@Bruno hello")
        deactivated = await team["owner"].post(
            f"/api/admin/users/{team['bruno'].user_id}/deactivate"
        )
        assert deactivated.status == 200, deactivated.body

        users, _ = await recent(team["owner"])

        assert users == [team["ana"].user_id]

    async def test_an_id_from_another_workspace_is_dropped(self, team: dict[str, Any]) -> None:
        # Unreachable through the send path, which resolves names inside the workspace.
        # The boundary is in the statement anyway, so no caller has to remember it.
        stranger = new_id()
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO users (id, workspace_id, email, display_name)
                    VALUES (:id, :ws, 'stranger@example.com', 'Stranger')
                    """
                ),
                {"id": stranger, "ws": await another_workspace()},
            )
        await insert_message(team, new_id(), users=[team["ana"].user_id, stranger])

        users, _ = await recent(team["owner"])

        assert users == [team["ana"].user_id]

    async def test_a_webhook_posting_as_you_tags_nobody(self, team: dict[str, Any]) -> None:
        # An incoming webhook posts as the admin who created it, with kind "bot". Whom it
        # names is the integration's business, not theirs — and a busy one would push
        # their own tags out of the window.
        created = await team["owner"].post(
            "/api/admin/webhooks", {"channelId": team["general"], "name": "CI"}
        )
        assert created.status == 200, created.body
        token = created.body["url"].split("/api/hooks/")[1]
        posted = (
            await team["owner"].fork().post(f"/api/hooks/{token}", {"text": "@Ana the build broke"})
        )
        assert posted.status == 202, posted.body
        await tag(team["owner"], team["general"], "@Bruno can you look?")

        # The post really is the owner's and really names Ana, so her absence below is
        # the rule at work rather than a mention that never resolved.
        history = await team["owner"].get(f"/api/channels/{team['general']}/messages?limit=5")
        hooked = next(m for m in history.body["messages"] if m["body"] == "@Ana the build broke")
        assert hooked["authorId"] == team["owner"].user_id
        assert hooked["mentionUserIds"] == [team["ana"].user_id]

        users, _ = await recent(team["owner"])

        assert users == [team["bruno"].user_id]


class TestGroups:
    async def test_groups_are_ordered_the_same_way(self, team: dict[str, Any]) -> None:
        platform = await make_group(team["owner"], "platform-team")
        design = await make_group(team["owner"], "designers")

        await tag(team["owner"], team["general"], "@platform-team can you look?")
        await tag(team["owner"], team["general"], "@designers can you look?")
        assert (await recent(team["owner"]))[1] == [design, platform]

        await tag(team["owner"], team["general"], "@platform-team again")
        assert (await recent(team["owner"]))[1] == [platform, design]

    async def test_a_group_and_a_person_land_in_their_own_lists(self, team: dict[str, Any]) -> None:
        platform = await make_group(team["owner"], "platform-team")

        await tag(team["owner"], team["general"], "@Ana and @platform-team, please")

        assert await recent(team["owner"]) == ([team["ana"].user_id], [platform])

    async def test_a_deleted_group_is_not_offered(self, team: dict[str, Any]) -> None:
        platform = await make_group(team["owner"], "platform-team")
        design = await make_group(team["owner"], "designers")
        await tag(team["owner"], team["general"], "@platform-team hello")
        await tag(team["owner"], team["general"], "@designers hello")

        assert (await team["owner"].delete(f"/api/admin/groups/{design}")).status == 200

        assert (await recent(team["owner"]))[1] == [platform]

    async def test_a_group_from_another_workspace_is_dropped(self, team: dict[str, Any]) -> None:
        # Same handle, other tenant: only the statement's own workspace check keeps it out.
        platform = await make_group(team["owner"], "platform-team")
        foreign = new_id()
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    """
                    INSERT INTO user_groups (id, workspace_id, handle, name)
                    VALUES (:id, :ws, 'platform-team', 'Platform Team')
                    """
                ),
                {"id": foreign, "ws": await another_workspace()},
            )
        await insert_message(team, new_id(), groups=[foreign, platform])

        _, groups = await recent(team["owner"])

        assert groups == [platform]


class TestTheBounds:
    async def test_each_list_stops_at_its_cap(self, team: dict[str, Any]) -> None:
        extra = KEEP + 5
        people = await insert_people(team["workspace_id"], extra)
        groups = await insert_groups(team["workspace_id"], extra)
        for message_id, person, group in zip(ascending_ids(extra), people, groups, strict=True):
            await insert_message(team, message_id, users=[person], groups=[group])

        users, group_ids = await recent(team["owner"])

        # Newest first: the last one written leads, and the oldest five fall off the end.
        assert users == list(reversed(people))[:KEEP]
        assert group_ids == list(reversed(groups))[:KEEP]

    async def test_the_scan_reads_only_the_newest_messages(self, team: dict[str, Any]) -> None:
        # A bound on the work, counted in messages rather than in mentions: somebody who
        # rarely tags anyone must not make every boot walk their whole history looking.
        ids = ascending_ids(SCAN_LIMIT + 1)
        await insert_message(team, ids[0], users=[team["ana"].user_id])
        await insert_plain_messages(team, ids[1:SCAN_LIMIT])

        # The mention is the oldest of exactly SCAN_LIMIT messages, so it is still read.
        assert (await recent(team["owner"]))[0] == [team["ana"].user_id]

        await insert_plain_messages(team, ids[SCAN_LIMIT:])

        assert (await recent(team["owner"]))[0] == []
