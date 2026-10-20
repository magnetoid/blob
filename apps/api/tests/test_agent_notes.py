"""Notes an agent keeps, in words people can read (M2 · A8).

Kept with `remember`, found with `recall`, removed with `forget` — in the agent's memory
scope (ADR 0024): the conversation's for the workspace's agent, one person's for an agent
somebody owns. A run is handed its newest notes up front. People read, reword and remove
them — a person their own, an admin a conversation's in rooms they can see — and a scope
nobody has written a note in for ninety days is swept.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.plugins import agui
from blob_api.services import agent_notes

from .helpers import send_message
from .test_agent_tools import (
    allow,
    ask,
    calls,
    requests,
    says,
    team_fixture,  # noqa: F401 — the `team` fixture: a fake agent in #general
    tool_results,
)
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse in its own module


async def notes_in_db() -> list[dict[str, Any]]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT id, body, channel_id, person_id FROM agent_notes ORDER BY created_at")
            )
        ).fetchall()
    return [dict(row._mapping) for row in rows]


def context_notes(body: dict[str, Any]) -> str | None:
    found = [item["value"] for item in body["context"] if item["description"] == "notes"]
    return found[0] if found else None


class TestKeeping:
    async def test_remember_recall_forget_and_the_next_run_is_handed_them(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "read")
        await ask(
            team,
            "@Helper note that staging is blue-2",
            calls(("c1", "remember", {"text": "Staging is called blue-2."})),
            says("Noted."),
        )
        offered = {tool["name"] for tool in requests(team)[0]["tools"]}
        assert {"remember", "recall", "forget"} <= offered
        [kept] = await notes_in_db()
        assert kept["body"] == "Staging is called blue-2."
        assert str(kept["channel_id"]) == team["general"]
        assert kept["person_id"] is None  # the workspace's agent: the conversation's note
        [result] = tool_results(requests(team)[1])
        assert result["content"] == f"Kept, as note {kept['id']}."

        team["state"]["seen"] = []
        await ask(
            team,
            "@Helper what is staging called?",
            calls(("c2", "recall", {"query": "staging"})),
            says("blue-2"),
        )
        handed = context_notes(requests(team)[0])
        assert handed is not None and "Staging is called blue-2." in handed
        assert handed.startswith(agui.NOTES_PREAMBLE)
        [found] = tool_results(requests(team)[1])
        assert "Staging is called blue-2." in found["content"]

        team["state"]["seen"] = []
        await ask(
            team,
            "@Helper staging was renamed",
            calls(("c3", "forget", {"note_id": str(kept["id"])})),
            says("Forgotten."),
        )
        assert await notes_in_db() == []

    async def test_an_agent_with_no_tools_keeps_no_notes(self, team: dict[str, Any]) -> None:
        await ask(team, "@Helper hello", says("Hi."))
        body = requests(team)[0]
        assert body["tools"] == []
        assert context_notes(body) is None

    async def test_notes_stay_in_their_conversation(self, team: dict[str, Any]) -> None:
        await allow(team, "read")
        await ask(
            team,
            "@Helper remember this",
            calls(("c1", "remember", {"text": "The launch is in May."})),
            says("Noted."),
        )
        dm = await team["owner"].post("/api/dms", {"userIds": [team["app"]["plugin"]["botUserId"]]})
        team["state"]["seen"] = []
        await ask(team, "@Helper anything?", says("Nothing here."), where=dm.body["channel"]["id"])
        assert context_notes(requests(team)[0]) is None

    async def test_a_full_scope_is_refused_in_words(
        self, team: dict[str, Any], monkeypatch: Any
    ) -> None:
        monkeypatch.setattr(agent_notes, "NOTES_PER_SCOPE", 1)
        await allow(team, "read")
        await ask(
            team,
            "@Helper remember two things",
            calls(
                ("c1", "remember", {"text": "One."}),
                ("c2", "remember", {"text": "Two."}),
            ),
            says("Done."),
        )
        first, second = tool_results(requests(team)[1])
        assert first["content"].startswith("Kept")
        assert "forget one" in second["content"]

    async def test_a_run_nobody_addressed_is_offered_no_notes_tools(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "read")
        followed = await team["owner"].put(
            f"/api/admin/plugins/{team['plugin_id']}/follows/{team['general']}"
        )
        assert followed.status == 200, followed.body
        await ask(team, "the build is red again", says("I can look."))
        offered = {tool["name"] for tool in requests(team)[0]["tools"]}
        assert not offered & {"remember", "recall", "forget"}


class TestWhoSeesThem:
    async def _keep(self, team: dict[str, Any], channel: str, person: str | None, body: str) -> str:
        async with transaction() as (session, _after):
            note = await agent_notes.keep(
                session,
                agent_notes.Scope(
                    workspace_id=team["owner_workspace"],
                    plugin_id=team["plugin_id"],
                    channel_id=channel,
                    person_id=person,
                ),
                body,
            )
        return note.id

    async def test_a_person_reads_rewords_and_removes_their_own(self, team: dict[str, Any]) -> None:
        team["owner_workspace"] = await _workspace_of(team)
        mine = await self._keep(team, team["general"], team["member"].user_id, "Prefers Mondays.")
        await self._keep(team, team["general"], None, "The conversation's note.")

        listed = await team["member"].get("/api/agents/notes")
        assert [n["body"] for n in listed.body["notes"]] == ["Prefers Mondays."]
        assert (await team["owner"].get("/api/agents/notes")).body["notes"] == []

        reworded = await team["member"].patch(
            f"/api/agents/notes/{mine}", {"body": "Prefers Tuesdays."}
        )
        assert reworded.status == 200 and reworded.body["body"] == "Prefers Tuesdays."
        assert (await team["owner"].patch(f"/api/agents/notes/{mine}", {"body": "x"})).status == 404
        assert (await team["member"].delete(f"/api/agents/notes/{mine}")).status == 200
        assert (await team["member"].get("/api/agents/notes")).body["notes"] == []

    async def test_an_admin_sees_conversation_notes_in_rooms_they_can_see(
        self, team: dict[str, Any]
    ) -> None:
        team["owner_workspace"] = await _workspace_of(team)
        private = await team["member"].post(
            "/api/channels", {"name": "quiet", "kind": "private", "memberIds": []}
        )
        await self._keep(team, team["general"], None, "In general.")
        await self._keep(
            team, private.body["channel"]["id"], None, "In a room the owner is not in."
        )
        await self._keep(team, team["general"], team["member"].user_id, "A person's own.")

        url = f"/api/admin/plugins/{team['plugin_id']}/notes"
        listed = await team["owner"].get(url)
        assert [n["body"] for n in listed.body["notes"]] == ["In general."]
        assert (await team["member"].get(url)).status == 403
        note_id = listed.body["notes"][0]["id"]
        fixed = await team["owner"].patch(f"{url}/{note_id}", {"body": "In #general."})
        assert fixed.status == 200 and fixed.body["body"] == "In #general."
        assert (await team["owner"].delete(f"{url}/{note_id}")).status == 200
        assert (await team["owner"].get(url)).body["notes"] == []


class TestEnding:
    async def test_a_quiet_conversations_notes_are_swept_together(
        self, team: dict[str, Any]
    ) -> None:
        workspace = await _workspace_of(team)
        await send_message(team["owner"], team["general"], "hi")
        quiet = agent_notes.Scope(workspace, team["plugin_id"], team["general"], None)
        lively = agent_notes.Scope(
            workspace, team["plugin_id"], team["general"], team["member"].user_id
        )
        async with transaction() as (session, _after):
            old = await agent_notes.keep(session, quiet, "Old fact.")
            await agent_notes.keep(session, lively, "Recent fact.")
            await session.execute(
                text(
                    "UPDATE agent_notes SET updated_at = now() - interval '91 days' WHERE id = :id"
                ),
                {"id": old.id},
            )
        async with transaction() as (session, _after):
            assert await agent_notes.sweep(session) == 1
        assert [n["body"] for n in await notes_in_db()] == ["Recent fact."]


async def _workspace_of(team: dict[str, Any]) -> str:
    async with SessionFactory() as session:
        return str(
            (
                await session.execute(
                    text("SELECT workspace_id FROM plugins WHERE id = :id"),
                    {"id": team["plugin_id"]},
                )
            ).scalar_one()
        )
