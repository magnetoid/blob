"""An agent and the decision log (M2 · A8): it may read the log, and propose — never decide.

Reading comes with read access, inside the room like every read. Proposing comes with
write access and is *always* put to the person the agent works for, whatever an admin let
its posts do: approved, the decision is recorded in that person's name, with the agent
named as the one that proposed it; declined, nothing is recorded.
"""

from __future__ import annotations

from typing import Any

from .helpers import send_message
from .test_agent_tools import (
    allow,
    ask,
    calls,
    press,
    requests,
    resume_after,
    says,
    team_fixture,  # noqa: F401 — the `team` fixture: a fake agent in #general
    the_run,
    tool_results,
)
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module


async def decisions(team: dict[str, Any]) -> list[dict[str, Any]]:
    listed = await team["owner"].get("/api/decisions")
    return list(listed.body["decisions"])


class TestReading:
    async def test_the_log_is_read_inside_the_room(self, team: dict[str, Any]) -> None:
        await allow(team, "read")
        made = await team["owner"].post(
            f"/api/channels/{team['general']}/decisions",
            {"title": "Ship on Friday", "clientId": "d-1"},
        )
        assert made.status == 200, made.body
        await ask(
            team,
            "@Helper what did we decide?",
            calls(("c1", "list_decisions", {})),
            says("You decided to ship on Friday."),
        )
        offered = {tool["name"] for tool in requests(team)[0]["tools"]}
        assert "list_decisions" in offered and "record_decision" not in offered
        [result] = tool_results(requests(team)[1])
        assert "Ship on Friday" in result["content"]


class TestProposing:
    async def test_a_proposal_waits_for_the_person_and_is_recorded_in_their_name(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "write")
        said = await send_message(team["owner"], team["general"], "OK — Friday it is.")
        await ask(
            team,
            "@Helper note that we decided to ship Friday",
            calls(
                (
                    "c1",
                    "record_decision",
                    {
                        "title": "Ship on Friday",
                        "rationale": "QA signs off Thursday.",
                        "message_id": said.body["message"]["id"],
                    },
                )
            ),
        )
        offered = {tool["name"]: tool for tool in requests(team)[0]["tools"]}
        params = offered["record_decision"]["parameters"]
        # The conversation is the run's, and Blob keys the write itself.
        assert "channel" not in params["properties"]
        assert "client_msg_id" not in params["properties"]

        run = await the_run(team)
        assert run["status"] == "interrupted"
        [item] = run["interrupt"]["items"]
        assert "Helper proposes a decision for the log, in #general" in item["message"]
        assert "> Ship on Friday" in item["message"]
        assert "Why: QA signs off Thursday." in item["message"]
        assert await decisions(team) == []

        assert (await press(team, team["owner"], run, 0)).status == 200  # Approve
        await resume_after(team, run, says("Recorded."))

        [decision] = await decisions(team)
        assert decision["title"] == "Ship on Friday"
        assert decision["decidedBy"] == team["owner"].user_id
        assert decision["proposedBy"] == team["plugin_id"]
        assert decision["proposedByName"] == "Helper"
        assert decision["messageId"] == said.body["message"]["id"]
        [result] = tool_results(requests(team)[0])
        assert result["content"].startswith("Recorded in #general, in Owner's name")

    async def test_it_asks_even_where_posts_need_not(self, team: dict[str, Any]) -> None:
        answer = await team["owner"].post(
            f"/api/admin/plugins/{team['plugin_id']}/tools",
            {"access": "write", "approval": "auto_everywhere"},
        )
        assert answer.status == 200, answer.body
        await ask(
            team,
            "@Helper log it",
            calls(("c1", "record_decision", {"title": "Weekly demos"})),
        )
        assert (await the_run(team))["status"] == "interrupted"
        assert await decisions(team) == []

    async def test_a_declined_proposal_is_not_recorded(self, team: dict[str, Any]) -> None:
        await allow(team, "write")
        await ask(
            team, "@Helper log it", calls(("c1", "record_decision", {"title": "Weekly demos"}))
        )
        run = await the_run(team)
        assert (await press(team, team["owner"], run, 1)).status == 200  # Deny
        await resume_after(team, run, says("Understood."))
        assert await decisions(team) == []
        [result] = tool_results(requests(team)[0])
        assert "declined: it was not recorded" in result["content"]

    async def test_one_that_could_never_be_recorded_is_answered_at_once(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "write")
        await ask(
            team,
            "@Helper log it",
            calls(("c1", "record_decision", {"title": "x" * 201})),
            says("Too long, sorry."),
        )
        assert (await the_run(team))["status"] == "succeeded"
        [result] = tool_results(requests(team)[1])
        assert "one line" in result["content"]
