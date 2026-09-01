"""Search, its modifier grammar, and the permission boundary."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest
import pytest_asyncio

from blob_api.services.search import parse_query

from .helpers import Client, invite_and_sign_up, send_message, sign_up


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    outsider = await invite_and_sign_up(owner, "Outsider")

    channels = (await owner.get("/api/channels")).body["channels"]
    general = next(c for c in channels if c["name"] == "general")

    secret = (
        await owner.post(
            "/api/channels",
            {"name": "secret-plans", "kind": "private", "memberIds": [member.user_id]},
        )
    ).body["channel"]
    await send_message(owner, secret["id"], "the pineapple flies at midnight")

    return {
        "owner": owner,
        "member": member,
        "outsider": outsider,
        "general": general,
        "secret": secret,
    }


# ─── the modifier grammar ─────────────────────────────────────────────────────
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("deploy failed", {"text": "deploy failed"}),
        ("from:@ana deploy", {"text": "deploy", "author": "ana"}),
        ("in:#eng deploy", {"text": "deploy", "channel": "eng"}),
        ("has:link deploy", {"text": "deploy", "has": "link"}),
        ("has:nonsense deploy", {"text": "deploy"}),
        (
            "before:2026-01-01 deploy",
            {"text": "deploy", "before": datetime(2026, 1, 1, tzinfo=UTC)},
        ),
        ("weird:thing deploy", {"text": "weird:thing deploy"}),
    ],
)
def test_parse_query(raw: str, expected: dict) -> None:
    parsed = parse_query(raw)
    for key, value in expected.items():
        assert getattr(parsed, key) == value


# ─── searching ────────────────────────────────────────────────────────────────
async def test_finds_a_message_by_word(team: dict) -> None:
    await send_message(team["owner"], team["general"]["id"], "the quick brown fox jumped")
    response = await team["owner"].get("/api/search?q=brown")
    assert any("brown" in m["body"] for m in response.body["messages"])


async def test_returns_nothing_for_a_term_nobody_said(team: dict) -> None:
    response = await team["owner"].get("/api/search?q=xyzzyplughnothing")
    assert response.body["messages"] == []
    assert response.body["total"] == 0


async def test_the_from_modifier_narrows_by_author(team: dict) -> None:
    await send_message(team["member"], team["general"]["id"], "zephyrpineapples are unusual")
    response = await team["owner"].get(
        f"/api/search?q=from:@{team['member'].display_name} zephyrpineapples"
    )
    assert response.body["parsed"]["from"] == team["member"].display_name
    assert response.body["messages"]
    assert all(m["authorId"] == team["member"].user_id for m in response.body["messages"])


async def test_the_in_modifier_narrows_by_channel(team: dict) -> None:
    await send_message(team["owner"], team["general"]["id"], "quaxolotl lives here")
    response = await team["owner"].get("/api/search?q=in:%23general quaxolotl")
    assert response.body["messages"]
    assert all(m["channelId"] == team["general"]["id"] for m in response.body["messages"])


async def test_a_deleted_message_leaves_the_index(team: dict) -> None:
    sent = await send_message(team["owner"], team["general"]["id"], "ephemeralwidget")
    assert (await team["owner"].get("/api/search?q=ephemeralwidget")).body["total"] == 1

    await team["owner"].delete(f"/api/messages/{sent.body['message']['id']}")
    assert (await team["owner"].get("/api/search?q=ephemeralwidget")).body["total"] == 0


async def test_total_counts_all_matches_even_when_the_page_is_limited(team: dict) -> None:
    for i in range(3):
        await send_message(team["owner"], team["general"]["id"], f"reindex-me {i}")

    response = await team["owner"].get("/api/search?q=reindex-me&limit=1")
    assert len(response.body["messages"]) == 1
    assert response.body["total"] == 3


# This is the security boundary: search joins against channel_members, and removing
# that join would leak every private channel workspace-wide.
async def test_private_messages_stay_out_of_a_non_members_results(team: dict) -> None:
    outsider_hits = await team["outsider"].get("/api/search?q=pineapple")
    assert outsider_hits.body["messages"] == []

    member_hits = await team["member"].get("/api/search?q=pineapple")
    assert len(member_hits.body["messages"]) > 0


# ─── reconnect sync ───────────────────────────────────────────────────────────
async def test_sync_returns_only_what_was_missed(team: dict) -> None:
    first = await send_message(team["owner"], team["general"]["id"], "before the gap")
    cursor = first.body["message"]["id"]
    await send_message(team["owner"], team["general"]["id"], "after the gap")

    import json

    response = await team["member"].get(
        f"/api/sync?cursors={json.dumps({team['general']['id']: cursor})}"
    )
    bodies = [m["body"] for m in response.body["messages"]]
    assert bodies == ["after the gap"]
    assert response.body["resyncChannelIds"] == []


async def test_sync_without_cursors_replays_nothing(team: dict) -> None:
    await send_message(team["owner"], team["general"]["id"], "hello")
    response = await team["member"].get("/api/sync")
    assert response.body["messages"] == []
    # It still returns the channel list, which is how the client refreshes its sidebar.
    assert len(response.body["channels"]) > 0


class TestDateModifiers:
    async def test_a_bad_date_is_refused_as_input(self, team: dict) -> None:
        # `before:` lands in a `CAST(:x AS timestamptz)`; anything Postgres cannot
        # parse there was an asyncpg DataError, which the catch-all made a 500. The
        # contract says a caller's typo is a 400.
        response = await team["owner"].get("/api/search?q=before:tuesday")
        assert response.status == 400, response.body
        assert response.body["error"]["code"] == "bad_request"

    async def test_a_real_date_still_narrows(self, team: dict) -> None:
        response = await team["owner"].get("/api/search?q=pineapple after:2020-01-01")
        assert response.status == 200, response.body


class TestAModifierThatNamesNobody:
    """A filter that matches nothing must narrow the search to nothing.

    `author_id=None` means "no filter" to the service, so an unresolved name used to fall
    through to the *unfiltered* result set — `from:@nobody` answered with every message
    in the workspace, and `from:@Marko`, when the display name was "Marko Ilic", answered
    as though Marko had written all of them. Widening a search in response to a narrowing
    term is the one answer that cannot be right.
    """

    async def test_an_unknown_person_finds_nothing(self, team: dict) -> None:
        await send_message(team["owner"], team["general"]["id"], "kumquatzephyr sighted")
        everything = await team["owner"].get("/api/search?q=kumquatzephyr")
        assert everything.body["total"] >= 1

        answer = await team["owner"].get("/api/search?q=from:@nobodyatall kumquatzephyr")

        assert answer.body["messages"] == []
        assert answer.body["total"] == 0
        assert "from:nobodyatall" in answer.body["parsed"]["unresolved"]

    async def test_an_unknown_channel_finds_nothing(self, team: dict) -> None:
        await send_message(team["owner"], team["general"]["id"], "kumquatzephyr again")

        answer = await team["owner"].get("/api/search?q=in:%23nosuchchannel kumquatzephyr")

        assert answer.body["messages"] == []
        assert "in:nosuchchannel" in answer.body["parsed"]["unresolved"]

    async def test_a_first_name_finds_the_person(self, team: dict) -> None:
        # Display names are full names and people type what they say out loud.
        joiner = await invite_and_sign_up(team["owner"], "Marko Ilic")
        await team["owner"].post(
            f"/api/channels/{team['general']['id']}/members", {"userIds": [joiner.user_id]}
        )
        await send_message(joiner, team["general"]["id"], "zanzibarquince")

        answer = await team["owner"].get("/api/search?q=from:@Marko zanzibarquince")

        assert answer.body["messages"], answer.body
        assert all(m["authorId"] == joiner.user_id for m in answer.body["messages"])

    async def test_an_ambiguous_first_name_finds_nothing_rather_than_guessing(
        self, team: dict
    ) -> None:
        # Two people share the prefix; picking the first would answer a question nobody
        # asked, and answer it differently as the workspace grows.
        one = await invite_and_sign_up(team["owner"], "Sam Carter")
        await invite_and_sign_up(team["owner"], "Sam Delgado")
        await team["owner"].post(
            f"/api/channels/{team['general']['id']}/members", {"userIds": [one.user_id]}
        )
        await send_message(one, team["general"]["id"], "yttriumbadger")

        answer = await team["owner"].get("/api/search?q=from:@Sam yttriumbadger")

        assert answer.body["messages"] == []
        assert "from:Sam" in answer.body["parsed"]["unresolved"]


class TestPagingThroughResults:
    """Reaching result 26.

    Search answered "Showing 25 of 2107" and offered no way to see the twenty-sixth,
    so anything not in the first page by rank was unreachable — you had to guess a
    narrower query and hope. The cursor is keyset rather than an offset, per ADR 0003:
    the next page is the rows sorting strictly below the last one shown, which does not
    re-scan what you have already read and does not shift under an arriving message.
    """

    async def test_paging_reaches_every_match_exactly_once(self, team: dict) -> None:
        # More than two pages, so a bug at the boundary has somewhere to show up.
        for index in range(12):
            await send_message(team["owner"], team["general"]["id"], f"quokkavine {index}")

        seen: list[str] = []
        cursor: str | None = None
        for _ in range(10):
            url = "/api/search?q=quokkavine&limit=5"
            if cursor:
                url += f"&cursor={cursor}"
            answer = await team["owner"].get(url)
            assert answer.status == 200, answer.body
            seen.extend(m["id"] for m in answer.body["messages"])
            cursor = answer.body["nextCursor"]
            if not cursor:
                break

        assert len(seen) == 12, seen
        assert len(set(seen)) == 12, "a message appeared on two pages"
        assert cursor is None, "the walk should end rather than offer another page"

    async def test_the_last_page_does_not_offer_another(self, team: dict) -> None:
        for index in range(3):
            await send_message(team["owner"], team["general"]["id"], f"narwhalcobalt {index}")

        answer = await team["owner"].get("/api/search?q=narwhalcobalt&limit=25")

        assert len(answer.body["messages"]) == 3
        assert answer.body["nextCursor"] is None

    async def test_a_full_final_page_offers_one_more_that_is_empty(self, team: dict) -> None:
        # The page is full, so we cannot know it is the last one without asking. Offering
        # a cursor that answers empty is better than withholding one that had results.
        for index in range(4):
            await send_message(team["owner"], team["general"]["id"], f"lemurgranite {index}")

        first = await team["owner"].get("/api/search?q=lemurgranite&limit=4")
        assert first.body["nextCursor"] is not None

        second = await team["owner"].get(
            f"/api/search?q=lemurgranite&limit=4&cursor={first.body['nextCursor']}"
        )
        assert second.body["messages"] == []

    async def test_a_forged_cursor_is_refused_rather_than_ignored(self, team: dict) -> None:
        answer = await team["owner"].get("/api/search?q=anything&cursor=notacursor")

        assert answer.status == 400
        assert answer.body["error"]["code"] == "bad_request"

    async def test_paging_does_not_cross_the_membership_boundary(self, team: dict) -> None:
        # The join against channel_members is the security boundary, and a second page
        # is a second query — it has to carry the same restriction as the first.
        private = (
            await team["owner"].post("/api/channels", {"name": "hidden-paging", "kind": "private"})
        ).body["channel"]
        for index in range(8):
            await send_message(team["owner"], private["id"], f"basiliskonyx {index}")

        answer = await team["member"].get("/api/search?q=basiliskonyx&limit=4")

        assert answer.body["messages"] == []
        assert answer.body["total"] == 0
        assert answer.body["nextCursor"] is None
