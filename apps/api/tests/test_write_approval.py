"""When an agent's post waits for the person, and when an admin said it need not (A3).

`plugins.write_approval` (migration 0054) is `ask` by default — every post an agent wants
to make is put to the person it works for. An admin may let it post without asking in its
own DM with that person (`auto_in_dm`), where nobody else's words can have steered it, or
everywhere (`auto_everywhere`). What none of them changes is where a post may go.
"""

from __future__ import annotations

from typing import Any

import pytest

from blob_api.jobs import agui_tools

from .helpers import send_message
from .test_agent_tools import (
    SUMMARY,
    allow,
    ask,
    calls,
    messages_in,
    requests,
    says,
    team_fixture,  # noqa: F401 — the `team` fixture
    the_run,
    tool_results,
)
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module


async def let(team: dict[str, Any], approval: str) -> dict[str, Any]:
    answer = await team["owner"].post(
        f"/api/admin/plugins/{team['plugin_id']}/tools",
        {"access": "write", "approval": approval},
    )
    assert answer.status == 200, answer.body
    assert answer.body["writeApproval"] == approval
    return dict(answer.body)


@pytest.mark.parametrize(
    ("approval", "in_dm", "expected"),
    [
        ("ask", True, False),
        ("ask", False, False),
        ("auto_in_dm", True, True),
        ("auto_in_dm", False, False),
        ("auto_everywhere", False, True),
        ("anything-else", True, False),
    ],
)
def test_who_is_asked(approval: str, in_dm: bool, expected: bool) -> None:
    assert agui_tools.writes_without_asking(approval, in_their_dm=in_dm) is expected


class TestTheSetting:
    async def test_it_asks_by_default_and_an_absent_approval_changes_nothing(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "write")
        listed = (await team["owner"].get("/api/admin/plugins")).body["plugins"]
        [plugin] = [p for p in listed if p["id"] == team["plugin_id"]]
        assert plugin["writeApproval"] == "ask"
        await let(team, "auto_in_dm")
        again = await team["owner"].post(
            f"/api/admin/plugins/{team['plugin_id']}/tools", {"access": "write"}
        )
        assert again.body["writeApproval"] == "auto_in_dm"

    async def test_only_an_admin_may_change_it_and_only_to_a_known_value(
        self, team: dict[str, Any]
    ) -> None:
        url = f"/api/admin/plugins/{team['plugin_id']}/tools"
        refused = await team["member"].post(url, {"access": "write", "approval": "auto_everywhere"})
        assert refused.status == 403
        nonsense = await team["owner"].post(url, {"access": "write", "approval": "sometimes"})
        assert nonsense.status == 400
        assert nonsense.body["error"]["code"] == "invalid_input"


class TestPostingWithoutAsking:
    async def test_everywhere_posts_at_once_and_the_run_carries_on(
        self, team: dict[str, Any]
    ) -> None:
        await let(team, "auto_everywhere")
        await ask(
            team,
            "@Helper post a summary here",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
            says("Posted it."),
        )
        run = await the_run(team)
        assert run["status"] == "succeeded"
        assert run["interrupt"] is None
        bodies = [m["body"] for m in await messages_in(team["general"])]
        assert SUMMARY in bodies and "Posted it." in bodies
        assert not any(body.startswith("Needs") for body in bodies), "nobody was asked"
        [result] = tool_results(requests(team)[1])
        assert result["content"].startswith("Posted in #general")

    async def test_a_call_id_the_agent_reuses_next_round_still_posts(
        self, team: dict[str, Any]
    ) -> None:
        """A call's id is the agent's to choose, and some frameworks number them from
        one every round. Keyed on the id alone, the second round's post was taken for a
        replay of the first: nothing posted, and the agent told it was."""
        await let(team, "auto_everywhere")
        await ask(
            team,
            "@Helper post two summaries here",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
            calls(("c1", "post_message", {"channel": "#general", "text": "Second: moved again."})),
            says("Posted both."),
        )
        assert (await the_run(team))["status"] == "succeeded"
        bodies = [m["body"] for m in await messages_in(team["general"])]
        assert SUMMARY in bodies and "Second: moved again." in bodies
        [first] = tool_results(requests(team)[1])
        [second] = tool_results(requests(team)[2])[-1:]
        assert first["content"].startswith("Posted in #general")
        assert second["content"].startswith("Posted in #general")

    async def test_in_dm_only_still_asks_in_a_channel(self, team: dict[str, Any]) -> None:
        await let(team, "auto_in_dm")
        await ask(
            team,
            "@Helper post a summary here",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
        )
        run = await the_run(team)
        assert run["status"] == "interrupted"
        assert run["interrupt"]["kind"] == "tool_approval"
        assert SUMMARY not in [m["body"] for m in await messages_in(team["general"])]

    async def test_in_dm_only_posts_without_asking_when_asked_in_its_dm(
        self, team: dict[str, Any]
    ) -> None:
        await let(team, "auto_in_dm")
        bot_id = team["app"]["plugin"]["botUserId"]
        dm = await team["owner"].post("/api/dms", {"userIds": [bot_id]})
        assert dm.status in (200, 201), dm.body
        await ask(
            team,
            # A hand-installed app is addressed in its DM too; only the resident agent
            # and a person's own answer a DM without one.
            "@Helper post the summary in #general",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
            says("Done — it's in #general."),
            where=dm.body["channel"]["id"],
        )
        assert (await the_run(team))["status"] == "succeeded"
        assert SUMMARY in [m["body"] for m in await messages_in(team["general"])]

    async def test_without_asking_is_never_further_than_the_room_allows(
        self, team: dict[str, Any]
    ) -> None:
        """Asked in #general, a post may go to #general or a public channel — not into a
        private one the person happens to be in, whatever the setting says."""
        await let(team, "auto_everywhere")
        private = await team["owner"].post(
            "/api/channels", {"name": "plans", "kind": "private", "memberIds": []}
        )
        await send_message(team["owner"], private.body["channel"]["id"], "Ship on the 12th.")
        await ask(
            team,
            "@Helper copy this into #plans",
            calls(("c1", "post_message", {"channel": "#plans", "text": SUMMARY})),
            says("I couldn't."),
        )
        [result] = tool_results(requests(team)[1])
        assert "no channel by that name" in result["content"]
        assert SUMMARY not in [m["body"] for m in await messages_in(private.body["channel"]["id"])]
