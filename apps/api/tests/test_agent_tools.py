"""An agent uses Blob's tools — as the person who asked, inside the room (ADR 0022).

`RunAgentInput.tools` was empty by design until an admin could decide otherwise. These pin
what that decision unlocks and what it never does: the tools are offered only to an agent
allowed them; every call runs as the person the run is on behalf of; in a channel the
agent reads public channels and that room and nothing else, and only in its own DM with
the person does it get their whole reach; a post waits for that person's Approve; and a
run that keeps calling is stopped.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.jobs import agui_tools
from blob_api.plugins import agui, streams
from blob_api.services import agent_chains

from .helpers import Client, invite_and_sign_up, send_message, sign_up
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse in its own module, needed here too
    frame,
    install,
    join_channel,
    messages_in,
)


async def _nothing() -> None:
    """What a recorded `enqueue` hands to `fire_and_forget`."""


def calls(*called: tuple[str, str, dict[str, Any]]) -> bytes:
    """A round that ends on calls to Blob's tools, the way a client-tools agent ends one."""
    out = [frame(type="RUN_STARTED", threadId="t", runId="r")]
    for call_id, name, arguments in called:
        out += [
            frame(type="TOOL_CALL_START", toolCallId=call_id, toolCallName=name),
            frame(type="TOOL_CALL_ARGS", toolCallId=call_id, delta=json.dumps(arguments)),
            frame(type="TOOL_CALL_END", toolCallId=call_id),
        ]
    out.append(frame(type="RUN_FINISHED", threadId="t", runId="r"))
    return b"".join(out)


def says(body: str) -> bytes:
    return b"".join(
        (
            frame(type="RUN_STARTED", threadId="t", runId="r"),
            frame(type="TEXT_MESSAGE_START", messageId="m"),
            frame(type="TEXT_MESSAGE_CONTENT", messageId="m", delta=body),
            frame(type="TEXT_MESSAGE_END", messageId="m"),
            frame(type="RUN_FINISHED", threadId="t", runId="r"),
        )
    )


@pytest_asyncio.fixture(name="team")
async def team_fixture(client: Client, monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Named apart from the parameter it fills, so a module importing it
    (`test_write_approval.py`) does not shadow it."""
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    app_body = await install(owner)
    await join_channel(owner, app_body, general)

    # One fake agent, answering each request with the next script; every request kept.
    state: dict[str, Any] = {"scripts": [], "seen": []}
    real = httpx.AsyncClient

    def handler(request: httpx.Request) -> httpx.Response:
        state["seen"].append(request)
        body = state["scripts"].pop(0) if state["scripts"] else says("(no more scripts)")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=body)

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        if isinstance(kwargs.get("transport"), httpx.ASGITransport):
            return real(**kwargs)
        kwargs.pop("transport", None)
        return real(**kwargs, transport=httpx.MockTransport(handler))

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)

    enqueued: list[tuple[Any, ...]] = []

    def record(job: str, *args: Any) -> Any:
        enqueued.append((job, *args))
        return _nothing()

    from blob_api.lib import queue as queue_module

    monkeypatch.setattr(agent_chains, "enqueue", record)
    monkeypatch.setattr(queue_module, "enqueue", record)
    return {
        "owner": owner,
        "member": member,
        "general": general,
        "app": app_body,
        "plugin_id": app_body["plugin"]["id"],
        "state": state,
    }


async def allow(team: dict[str, Any], access: str) -> None:
    answer = await team["owner"].post(
        f"/api/admin/plugins/{team['plugin_id']}/tools", {"access": access}
    )
    assert answer.status == 200, answer.body
    assert answer.body["toolAccess"] == access


async def ask(team: dict[str, Any], body: str, *scripts: bytes, where: str | None = None) -> str:
    team["state"]["scripts"] = list(scripts)
    sent = await send_message(team["owner"], where or team["general"], body)
    message_id = str(sent.body["message"]["id"])
    await agui_job.handle_agui_run(message_id)
    return message_id


def requests(team: dict[str, Any]) -> list[dict[str, Any]]:
    return [json.loads(r.content) for r in team["state"]["seen"]]


def tool_results(body: dict[str, Any]) -> list[dict[str, Any]]:
    return [m for m in body["messages"] if m["role"] == "tool"]


async def the_run(team: dict[str, Any]) -> dict[str, Any]:
    async with SessionFactory() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT id, status, error, interrupt, decision_message_id, card
                      FROM agent_runs WHERE plugin_id = :p
                     ORDER BY started_at DESC LIMIT 1
                    """
                ),
                {"p": team["plugin_id"]},
            )
        ).fetchone()
    assert row is not None
    return dict(row._mapping)


# ─── as arithmetic ────────────────────────────────────────────────────────────
class TestWhatTheFoldHears:
    def test_a_call_the_agent_left_for_blob_is_collected_with_its_arguments(self) -> None:
        fold = agui.Fold()
        fold.feed({"type": "TOOL_CALL_START", "toolCallId": "c1", "toolCallName": "read_thread"})
        fold.feed({"type": "TOOL_CALL_ARGS", "toolCallId": "c1", "delta": '{"message_'})
        fold.feed({"type": "TOOL_CALL_ARGS", "toolCallId": "c1", "delta": 'id": "x"}'})
        fold.feed({"type": "TOOL_CALL_START", "toolCallId": "c2", "toolCallName": "own_tool"})
        fold.feed({"type": "TOOL_CALL_START", "toolCallId": "c3", "toolCallName": "list_people"})
        # The agent ran this one itself and said so: it is not Blob's to run.
        fold.feed({"type": "TOOL_CALL_RESULT", "toolCallId": "c3", "content": "done"})
        [left] = fold.client_calls(agui_tools.offered_names("read"))
        assert left.name == "read_thread"
        assert left.parsed_arguments() == {"message_id": "x"}

    def test_the_compact_form_carries_its_arguments_too(self) -> None:
        fold = agui.Fold()
        fold.feed(
            {
                "type": "TOOL_CALL_CHUNK",
                "toolCallId": "c",
                "toolCallName": "list_people",
                "delta": "{}",
            }
        )
        [call] = fold.client_calls({"list_people"})
        assert call.parsed_arguments() == {}

    def test_arguments_past_the_cap_are_never_run(self) -> None:
        fold = agui.Fold()
        fold.feed({"type": "TOOL_CALL_START", "toolCallId": "c", "toolCallName": "list_people"})
        fold.feed(
            {
                "type": "TOOL_CALL_ARGS",
                "toolCallId": "c",
                "delta": "x" * (agui.TOOL_ARGS_MAX_CHARS + 1),
            }
        )
        [call] = fold.client_calls({"list_people"})
        assert call.oversized and call.parsed_arguments() is None

    def test_a_waiting_exchange_is_kept_small_and_every_call_keeps_a_result(self) -> None:
        big = "x" * (agui_tools.EXCHANGE_MAX_CHARS // 2 + 10)
        exchange = [
            {
                "role": "assistant",
                "toolCalls": [{"id": "a", "function": {"name": "n", "arguments": big}}],
            },
            {"role": "tool", "toolCallId": "a", "content": big},
            {
                "role": "assistant",
                "toolCalls": [{"id": "b", "function": {"name": "n", "arguments": "{}"}}],
            },
            {"role": "tool", "toolCallId": "b", "content": "recent"},
        ]
        kept = agui_tools.trim_exchange(exchange)
        assert sum(len(str(m.get("content") or "")) for m in kept) < agui_tools.EXCHANGE_MAX_CHARS
        assert kept[0]["toolCalls"][0]["function"]["arguments"] == "{}"
        assert kept[-1]["content"] == "recent"  # The newest result is the last to go.
        assert [m.get("toolCallId") for m in kept if m["role"] == "tool"] == ["a", "b"]

    def test_what_each_access_offers(self) -> None:
        assert agui_tools.offered("none") == []
        read = [tool["name"] for tool in agui_tools.offered("read")]
        # Never `whoami`, never a write. Asking another agent comes with reading: it posts
        # nothing a reply mentioning that agent could not (`agui_delegate`).
        # Its own notes come with reading (M2 · A8): they change nothing anybody else reads.
        # Coming back later too (ADR 0040): it posts nothing an answer could not.
        assert read == [
            *agui_tools.READ_TOOLS,
            "list_agents",
            "ask_agent",
            *agui_tools.MEMORY_TOOLS,
            *agui_tools.LATER_TOOLS,
        ]
        write = [tool["name"] for tool in agui_tools.offered("write")]
        # Proposing a decision comes with write access, and always asks (M2 · A8).
        assert write == [
            *agui_tools.READ_TOOLS,
            "list_agents",
            "post_message",
            "record_decision",
            "ask_agent",
            *agui_tools.MEMORY_TOOLS,
            *agui_tools.LATER_TOOLS,
        ]
        assert all(
            set(tool) == {"name", "description", "parameters"}
            for tool in agui_tools.offered("write")
        )


# ─── the round trip ───────────────────────────────────────────────────────────
class TestOffering:
    async def test_an_agent_nobody_allowed_is_offered_nothing(self, team: dict[str, Any]) -> None:
        await ask(team, "@Helper hello", says("Hi."))
        assert requests(team)[0]["tools"] == []

    async def test_only_an_admin_may_allow_it(self, team: dict[str, Any]) -> None:
        refused = await team["member"].post(
            f"/api/admin/plugins/{team['plugin_id']}/tools", {"access": "read"}
        )
        assert refused.status == 403

    async def test_an_app_that_answers_no_mention_cannot_be_offered_tools(
        self, team: dict[str, Any]
    ) -> None:
        hooks = await install(
            team["owner"],
            slug="hooks",
            name="Hooks",
            aguiUrl=None,
            requestUrl="https://apps.example.com/hooks",
            events=["message.created"],
        )
        refused = await team["owner"].post(
            f"/api/admin/plugins/{hooks['plugin']['id']}/tools", {"access": "read"}
        )
        assert refused.status == 400
        assert refused.body["error"]["code"] == "not_an_agent"


class TestReading:
    async def test_a_read_runs_as_the_person_and_the_run_carries_on_with_the_result(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "read")
        await send_message(team["owner"], team["general"], "The launch moved to Friday.")

        await ask(
            team,
            "@Helper when is the launch?",
            calls(("c1", "search_messages", {"query": "launch"})),
            says("The launch is on Friday."),
        )

        first, second = requests(team)
        assert [tool["name"] for tool in first["tools"]] == [
            *agui_tools.READ_TOOLS,
            *agui_tools.DELEGATE_TOOLS,
            *agui_tools.MEMORY_TOOLS,
            *agui_tools.LATER_TOOLS,
        ]
        # The next round is the same conversation with the agent's turn and its result.
        turn = second["messages"][-2]
        assert turn["role"] == "assistant"
        assert turn["toolCalls"][0]["function"]["name"] == "search_messages"
        [result] = tool_results(second)
        assert result["toolCallId"] == "c1"
        assert "The launch moved to Friday." in result["content"]
        assert second["runId"] != first["runId"]
        bodies = [m["body"] for m in await messages_in(team["general"])]
        assert "The launch is on Friday." in bodies
        run = await the_run(team)
        assert run["status"] == "succeeded"
        # What it called, on the card the channel reads.
        assert run["card"]["tools"][0]["name"] == "search_messages"

    async def test_a_private_channel_outside_the_room_is_no_such_channel(
        self, team: dict[str, Any]
    ) -> None:
        # The person can read #salaries; the room they asked in cannot. 0017's case.
        await allow(team, "read")
        private = await team["owner"].post(
            "/api/channels", {"name": "salaries", "kind": "private", "memberIds": []}
        )
        assert private.status == 200, private.body
        await send_message(team["owner"], private.body["channel"]["id"], "Everyone's pay.")

        await ask(
            team,
            "@Helper summarise #salaries for us",
            calls(("c1", "read_channel", {"channel": "#salaries"})),
            says("I cannot see that."),
        )

        [result] = tool_results(requests(team)[1])
        assert result["content"] == "Error: There is no channel by that name."
        assert "Everyone's pay." not in json.dumps(requests(team)[1])

    async def test_search_from_a_room_does_not_reach_private_channels(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "read")
        private = await team["owner"].post(
            "/api/channels", {"name": "board", "kind": "private", "memberIds": []}
        )
        await send_message(team["owner"], private.body["channel"]["id"], "The acquisition closes.")

        await ask(
            team,
            "@Helper anything about the acquisition?",
            calls(("c1", "search_messages", {"query": "acquisition"})),
            says("Nothing I can see."),
        )

        [result] = tool_results(requests(team)[1])
        assert "acquisition closes" not in result["content"]

    async def test_in_its_own_dm_with_the_person_it_reads_their_whole_reach(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "read")
        private = await team["owner"].post(
            "/api/channels", {"name": "plans", "kind": "private", "memberIds": []}
        )
        await send_message(team["owner"], private.body["channel"]["id"], "Ship on the 12th.")
        bot_id = team["app"]["plugin"]["botUserId"]
        dm = await team["owner"].post("/api/dms", {"userIds": [bot_id]})
        assert dm.status in (200, 201), dm.body

        await ask(
            team,
            "@Helper what does #plans say?",
            calls(("c1", "read_channel", {"channel": "#plans"})),
            says("Ship on the 12th."),
            where=dm.body["channel"]["id"],
        )

        [result] = tool_results(requests(team)[1])
        assert "Ship on the 12th." in result["content"]

    async def test_a_run_that_keeps_calling_is_stopped(self, team: dict[str, Any]) -> None:
        await allow(team, "read")
        endless = [
            calls((f"c{n}", "list_people", {})) for n in range(agui_tools.MAX_TOOL_ROUNDS + 2)
        ]
        await ask(team, "@Helper loop", *endless)

        assert len(requests(team)) == agui_tools.MAX_TOOL_ROUNDS
        run = await the_run(team)
        assert run["status"] == "failed"
        assert "more than" in run["error"]


async def press(team: dict[str, Any], who: Client, run: dict[str, Any], index: int) -> Any:
    return await who.post(
        "/api/interactions",
        {
            "messageId": str(run["decision_message_id"]),
            "actionId": f"agent_answer:{run['id']}:{index}",
            "value": "",
            "clientActionId": f"press-{index}",
        },
    )


async def resume_after(team: dict[str, Any], run: dict[str, Any], *scripts: bytes) -> None:
    async with SessionFactory() as session:
        answer_id = (
            await session.execute(
                text("SELECT id FROM messages WHERE client_msg_id LIKE :prefix"),
                {"prefix": f"agent-answer:{run['id']}:%"},
            )
        ).scalar_one()
    team["state"]["scripts"] = list(scripts)
    team["state"]["seen"] = []
    await agui_job.handle_agui_run(str(answer_id), str(run["id"]))


SUMMARY = "Summary: the launch moved to Friday."


class TestWriting:
    async def test_a_post_waits_for_the_persons_approval_and_then_is_made(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "write")
        await ask(
            team,
            "@Helper post a summary here",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
        )

        run = await the_run(team)
        assert run["status"] == "interrupted"
        assert run["interrupt"]["kind"] == "tool_approval"
        assert SUMMARY not in [m["body"] for m in await messages_in(team["general"])]
        decision = [
            m["body"] for m in await messages_in(team["general"]) if m["body"].startswith("Needs")
        ]
        assert decision and "Helper wants to post in #general" in decision[0]

        pressed = await press(team, team["owner"], run, 0)  # Approve
        assert pressed.status == 200, pressed.body
        await resume_after(team, run, says("Posted it."))

        bodies = [m["body"] for m in await messages_in(team["general"])]
        assert SUMMARY in bodies
        assert "Posted it." in bodies
        [result] = tool_results(requests(team)[0])
        assert result["toolCallId"] == "c1"
        assert result["content"].startswith("Posted in #general")

    async def test_a_denied_post_is_not_made_and_the_agent_is_told(
        self, team: dict[str, Any]
    ) -> None:
        await allow(team, "write")
        await ask(
            team,
            "@Helper post a summary here",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
        )
        run = await the_run(team)

        assert (await press(team, team["owner"], run, 1)).status == 200  # Deny
        await resume_after(team, run, says("Understood."))

        assert SUMMARY not in [m["body"] for m in await messages_in(team["general"])]
        [result] = tool_results(requests(team)[0])
        assert "declined" in result["content"]

    async def test_only_the_person_who_asked_may_approve(self, team: dict[str, Any]) -> None:
        await allow(team, "write")
        await ask(
            team,
            "@Helper post a summary here",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
        )
        run = await the_run(team)

        refused = await press(team, team["member"], run, 0)
        assert refused.status == 403

    async def test_a_post_that_could_never_be_made_is_not_put_to_the_person(
        self, team: dict[str, Any]
    ) -> None:
        # The bot is not in #random (every workspace has one; the bot joined only
        # #general). Asking somebody to approve a post that would then fail is a question
        # with no right answer; the agent is told at once instead.
        await allow(team, "write")

        await ask(
            team,
            "@Helper post it in #random",
            calls(("c1", "post_message", {"channel": "#random", "text": SUMMARY})),
            says("I am not in #random."),
        )

        assert (await the_run(team))["status"] == "succeeded"
        [result] = tool_results(requests(team)[1])
        assert "not a member" in result["content"]

    async def test_a_thread_that_is_not_one_is_refused_before_anybody_is_asked(
        self, team: dict[str, Any]
    ) -> None:
        # An id that names no message would only fail after the person approved it.
        await allow(team, "write")
        bad = {"channel": "#general", "text": "hi", "thread_root_id": "nope"}
        await ask(
            team,
            "@Helper reply in that thread",
            calls(("c1", "post_message", bad)),
            says("That was not a thread."),
        )
        [result] = tool_results(requests(team)[1])
        assert "has to be the id of a message" in result["content"]
        assert (await the_run(team))["status"] == "succeeded"

    async def test_tools_are_not_offered_when_the_person_who_asked_is_gone(
        self, team: dict[str, Any]
    ) -> None:
        # Every call runs as that person. With nobody to run as, offering the tools would
        # be a promise the run cannot keep.
        await allow(team, "read")
        team["state"]["scripts"] = [says("Hello.")]
        sent = await send_message(team["member"], team["general"], "@Helper hello")
        deactivated = await team["owner"].post(
            f"/api/admin/users/{team['member'].user_id}/deactivate"
        )
        assert deactivated.status == 200, deactivated.body
        await agui_job.handle_agui_run(str(sent.body["message"]["id"]))

        assert all(body["tools"] == [] for body in requests(team))

    async def test_reading_access_is_not_writing_access(self, team: dict[str, Any]) -> None:
        # With `read`, `post_message` is not offered — and a call to it anyway is not run.
        await allow(team, "read")
        await ask(
            team,
            "@Helper post a summary",
            calls(("c1", "post_message", {"channel": "#general", "text": SUMMARY})),
        )

        assert len(requests(team)) == 1
        assert SUMMARY not in [m["body"] for m in await messages_in(team["general"])]
        assert (await the_run(team))["status"] == "succeeded"


class TestAQuestionAfterTools:
    async def test_the_resume_is_handed_the_calls_made_before_the_question(
        self, team: dict[str, Any]
    ) -> None:
        # Round one reads; round two stops to ask. The resume rebuilds the conversation
        # from the channel, which holds no tool calls — so without the exchange kept on
        # the run, the agent would be answered about calls it could no longer see.
        await allow(team, "read")
        asks_after = b"".join(
            (
                frame(type="RUN_STARTED", threadId="t", runId="r"),
                frame(
                    type="RUN_FINISHED",
                    outcome={
                        "type": "interrupt",
                        "interrupts": [
                            {
                                "id": "i1",
                                "message": "Post it?",
                                "responseSchema": {"type": "boolean"},
                            }
                        ],
                    },
                ),
            )
        )
        await ask(team, "@Helper check, then ask me", calls(("c1", "list_people", {})), asks_after)
        run = await the_run(team)
        assert run["status"] == "interrupted"

        assert (await press(team, team["owner"], run, 0)).status == 200
        await resume_after(team, run, says("Thanks."))

        [resumed] = requests(team)
        assert resumed["resume"][0]["interruptId"] == "i1"
        # Where it happened: after the question that started the run, before the agent's
        # own question and the person's answer.
        shape = [
            (m["role"], m.get("toolCallId") or (m.get("content") or "")[:20])
            for m in resumed["messages"]
        ]
        start = next(i for i, (role, said) in enumerate(shape) if said.startswith("@Helper check"))
        assert shape[start + 1][0] == "assistant"
        assert resumed["messages"][start + 1]["toolCalls"][0]["id"] == "c1"
        assert shape[start + 2] == ("tool", "c1")
        assert shape[start + 3][1].startswith("Needs a decision")
        assert shape[start + 4] == ("user", "Yes")
