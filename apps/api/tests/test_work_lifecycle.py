"""Work channels with a lifecycle (M2 · A10): versions, a thread per artifact, verdicts,
and a closing summary.

Pinned: the next version is found by title and kind, whoever publishes it, so an agent
iterating needs nothing new from AG-UI; one thread per artifact, shared by its versions,
hears each new one; sending an agent's work back mentions it and sets a run going on the
reviewer's authority, while an approval never does; and finishing says what was made and
where review left it, in the room and where the work started.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job

from .helpers import Client, send_message
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse there
from .test_work_channels import PUBLISHES_A_DIFF, run_kickoff, speak, start
from .test_work_channels import team as _team_fixture

team = _team_fixture

DIFF = "--- a/x.py\n+++ b/x.py\n@@ -1 +1,2 @@\n x = 1\n+limit = 30\n"


async def publish(who: Client, work_id: str, kind: str, title: str, body: str) -> dict[str, Any]:
    made = await who.post(
        f"/api/work/{work_id}/artifacts", {"kind": kind, "title": title, "body": body}
    )
    assert made.status == 201, made.body
    return dict(made.body["artifact"])


async def thread_of(who: Client, root_id: str) -> list[dict[str, Any]]:
    replies = await who.get(f"/api/messages/{root_id}/thread")
    assert replies.status == 200, replies.body
    return list(replies.body["messages"])


async def bodies_in(channel_id: str) -> list[str]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text("SELECT body FROM messages WHERE channel_id = :c ORDER BY id"),
                {"c": channel_id},
            )
        ).scalars()
        return list(rows)


def runs_for(team: dict, message_id: str) -> list[tuple[Any, ...]]:
    return [e for e in team["enqueued"] if e[0] == "agui_run" and e[1] == message_id]


class TestVersions:
    async def test_the_same_title_and_kind_again_is_its_next_version(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        work_id = started["work"]["id"]
        first = await publish(team["owner"], work_id, "diff", "Fix login", DIFF)
        second = await publish(team["owner"], work_id, "diff", "  fix LOGIN ", DIFF + "+x\n")
        other = await publish(team["owner"], work_id, "markdown", "Fix login", "notes")

        assert (first["version"], second["version"], other["version"]) == (1, 2, 1)
        assert second["supersedesId"] == first["id"]
        assert other["supersedesId"] is None
        detail = (await team["owner"].get(f"/api/work/{work_id}")).body
        assert len(detail["artifacts"]) == 3
        assert detail["work"]["artifactCount"] == 2, "a change and a document, not three things"

    async def test_an_agent_publishing_again_makes_versions_with_nothing_new(
        self, team: dict
    ) -> None:
        speak(team, *PUBLISHES_A_DIFF)
        started = await start(team)
        await run_kickoff(team)
        again = await send_message(team["owner"], started["channel"]["id"], "@Helper once more")
        await agui_job.handle_agui_run(str(again.body["message"]["id"]))

        detail = (await team["owner"].get(f"/api/work/{started['work']['id']}")).body
        versions = sorted((a["title"], a["version"]) for a in detail["artifacts"])
        assert versions == [
            ("Add the rate limit", 1),
            ("Add the rate limit", 2),
            ("Preview", 1),
            ("Preview", 2),
        ]


class TestAnAgentsVersion:
    async def test_is_announced_as_the_agent_and_sets_nothing_going(self, team: dict) -> None:
        """A version an agent publishes into a discussed artifact is said in the thread as
        the agent's own message — `kind="bot"`, its plugin — so it can never root a run,
        even in a channel an agent follows (ADR 0013)."""
        speak(team, *PUBLISHES_A_DIFF)
        started = await start(team)
        await run_kickoff(team)
        work_id = started["work"]["id"]
        diff = next(
            a
            for a in (await team["owner"].get(f"/api/work/{work_id}")).body["artifacts"]
            if a["kind"] == "diff"
        )
        opened = await team["owner"].post(f"/api/work/{work_id}/artifacts/{diff['id']}/discussion")
        assert opened.status == 200, opened.body
        # The agent follows its own work channel, so a person's message there would start a
        # run unaddressed: the notice must not be taken for one.
        followed = await team["owner"].put(
            f"/api/admin/plugins/{team['helper']['plugin']['id']}/follows/{started['channel']['id']}"
        )
        assert followed.status == 200, followed.body

        again = await send_message(team["owner"], started["channel"]["id"], "@Helper once more")
        await agui_job.handle_agui_run(str(again.body["message"]["id"]))

        async with SessionFactory() as session:
            notice = (
                await session.execute(
                    text(
                        "SELECT id, kind, plugin_id, author_id FROM messages"
                        " WHERE body = 'Published v2 of **Add the rate limit**.'"
                    )
                )
            ).one()
        assert notice.kind == "bot"
        assert str(notice.plugin_id) == team["helper"]["plugin"]["id"]
        assert str(notice.author_id) == team["helper"]["plugin"]["botUserId"]
        assert not runs_for(team, str(notice.id))


class TestDiscussion:
    async def test_one_thread_per_artifact_hears_each_new_version(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        work_id = started["work"]["id"]
        first = await publish(team["owner"], work_id, "diff", "Fix login", DIFF)

        opened = await team["owner"].post(f"/api/work/{work_id}/artifacts/{first['id']}/discussion")
        assert opened.status == 200, opened.body
        root = opened.body["threadRootId"]
        again = await team["owner"].post(f"/api/work/{work_id}/artifacts/{first['id']}/discussion")
        assert again.body["threadRootId"] == root
        assert "Discussing the change **Fix login** (v1)." in await bodies_in(
            started["channel"]["id"]
        )

        second = await publish(team["owner"], work_id, "diff", "Fix login", DIFF + "+y\n")
        assert second["reviewRootId"] == root
        replies = [m["body"] for m in await thread_of(team["owner"], root)]
        assert "Published v2 of **Fix login**." in replies

    async def test_only_the_rooms_members_may_discuss_or_review(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        work_id = started["work"]["id"]
        made = await publish(team["owner"], work_id, "diff", "Fix login", DIFF)
        outsider = team["ana"]
        assert (
            await outsider.post(f"/api/work/{work_id}/artifacts/{made['id']}/discussion")
        ).status == 404
        assert (
            await outsider.post(
                f"/api/work/{work_id}/artifacts/{made['id']}/review", {"verdict": "approved"}
            )
        ).status == 404


class TestVerdicts:
    async def test_sending_an_agents_work_back_mentions_it_and_sets_it_going(
        self, team: dict
    ) -> None:
        speak(team, *PUBLISHES_A_DIFF)
        started = await start(team)
        await run_kickoff(team)
        work_id = started["work"]["id"]
        diff = next(
            a
            for a in (await team["owner"].get(f"/api/work/{work_id}")).body["artifacts"]
            if a["kind"] == "diff"
        )
        bot = team["helper"]["plugin"]["botUserId"]

        sent_back = await team["owner"].post(
            f"/api/work/{work_id}/artifacts/{diff['id']}/review",
            {"verdict": "changes", "note": "Make it 60 a minute, and test it."},
        )
        assert sent_back.status == 200, sent_back.body
        assert [(r["verdict"], r["note"]) for r in sent_back.body["artifact"]["reviews"]] == [
            ("changes", "Make it 60 a minute, and test it.")
        ]
        root = sent_back.body["artifact"]["reviewRootId"]
        (reply,) = [m for m in await thread_of(team["owner"], root) if "Changes" in m["body"]]
        assert reply["body"].startswith("@Helper — Changes requested on v1:")
        assert reply["mentionUserIds"] == [bot]
        assert runs_for(team, reply["id"]), "the agent is asked, on the reviewer's authority"

    async def test_an_approval_never_sets_an_agent_going(self, team: dict) -> None:
        speak(team, *PUBLISHES_A_DIFF)
        started = await start(team)
        await run_kickoff(team)
        work_id = started["work"]["id"]
        diff = (await team["owner"].get(f"/api/work/{work_id}")).body["artifacts"][0]

        approved = await team["owner"].post(
            f"/api/work/{work_id}/artifacts/{diff['id']}/review", {"verdict": "approved"}
        )
        assert approved.status == 200, approved.body
        root = approved.body["artifact"]["reviewRootId"]
        (reply,) = [m for m in await thread_of(team["owner"], root) if "Approved" in m["body"]]
        assert reply["body"] == "Approved v1."
        assert reply["mentionUserIds"] == []
        assert not runs_for(team, reply["id"])

    async def test_a_persons_work_sent_back_reaches_them(self, team: dict) -> None:
        # Marko wrote the message the work started from, so he is in the room.
        theirs = await send_message(team["marko"], team["general"], "I can write the notes")
        started = await start(team, rootMessageId=theirs.body["message"]["id"], agentPluginIds=[])
        work_id = started["work"]["id"]
        notes = await publish(team["marko"], work_id, "markdown", "Notes", "# Notes")

        approved = await team["owner"].post(
            f"/api/work/{work_id}/artifacts/{notes['id']}/review", {"verdict": "approved"}
        )
        root = approved.body["artifact"]["reviewRootId"]
        (reply,) = [m for m in await thread_of(team["owner"], root) if "Approved" in m["body"]]
        assert reply["mentionUserIds"] == [team["marko"].user_id]

    async def test_one_verdict_per_person_and_a_send_back_says_why(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        work_id = started["work"]["id"]
        made = await publish(team["owner"], work_id, "diff", "Fix login", DIFF)
        url = f"/api/work/{work_id}/artifacts/{made['id']}/review"

        silent = await team["owner"].post(url, {"verdict": "changes"})
        assert silent.status == 400
        await team["owner"].post(url, {"verdict": "approved"})
        changed = await team["owner"].post(url, {"verdict": "changes", "note": "One more test."})
        assert [r["verdict"] for r in changed.body["artifact"]["reviews"]] == ["changes"]

    async def test_a_verdict_belongs_to_its_version(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        work_id = started["work"]["id"]
        first = await publish(team["owner"], work_id, "diff", "Fix login", DIFF)
        await team["owner"].post(
            f"/api/work/{work_id}/artifacts/{first['id']}/review", {"verdict": "approved"}
        )
        await publish(team["owner"], work_id, "diff", "Fix login", DIFF + "+z\n")
        detail = (await team["owner"].get(f"/api/work/{work_id}")).body["artifacts"]
        assert [(a["version"], len(a["reviews"])) for a in detail] == [(1, 1), (2, 0)]


class TestTheClosingSummary:
    async def test_done_says_what_was_made_and_where_review_left_it(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        work_id = started["work"]["id"]
        await publish(team["owner"], work_id, "diff", "Fix login", DIFF)
        latest = await publish(team["owner"], work_id, "diff", "Fix login", DIFF + "+z\n")
        await publish(team["owner"], work_id, "markdown", "Notes", "# Notes")
        await team["owner"].post(
            f"/api/work/{work_id}/artifacts/{latest['id']}/review", {"verdict": "approved"}
        )

        done = await team["owner"].post(f"/api/work/{work_id}/done")
        assert done.status == 200, done.body
        summary = "1 change, 1 document. Approved: Fix login (v2). Not reviewed: Notes (v1)."
        assert f"Done: **Rate limiting for the API**. {summary}" in await bodies_in(
            started["channel"]["id"]
        )
        where_it_started = [m["body"] for m in await thread_of(team["owner"], team["root_id"])]
        assert f"Finished **Rate limiting for the API**. {summary}" in where_it_started

        late = await team["owner"].post(
            f"/api/work/{work_id}/artifacts/{latest['id']}/review", {"verdict": "approved"}
        )
        assert late.status in (403, 409), late.body

    async def test_nothing_published_is_said_too(self, team: dict) -> None:
        started = await start(team, agentPluginIds=[])
        await team["owner"].post(f"/api/work/{started['work']['id']}/done")
        assert "Done: **Rate limiting for the API**. Nothing was published." in await bodies_in(
            started["channel"]["id"]
        )
