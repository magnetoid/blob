"""An app that answers over AG-UI.

Two halves. The first is the protocol as arithmetic — bytes in, messages out — which is
where the ordering rules live and where a real stream's chunk boundaries are simulated
exactly, because that is the thing most likely to be wrong and least likely to be noticed
(a record split across two TCP reads either reassembles or the answer silently loses a
word).

The second is the round trip: a person mentions an app, the app is called, and what it
streamed back is in the channel. What those assert is mostly *refusals* — a bot never
triggers a run, a disabled app is not called, an app that cannot see the channel says
nothing at all rather than announcing that it cannot see it.
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
from blob_api.lib import net, sse
from blob_api.plugins import agui
from blob_api.plugins.signing import SIGNATURE_HEADER, TIMESTAMP_HEADER, verify

from .helpers import (
    Client,
    allow_policy,
    invite_and_sign_up,
    send_message,
    sign_up,
    workspace_id_of,
)

APP = {
    "slug": "helper",
    "name": "Helper",
    "runtime": "external",
    "version": "1.0.0",
    "aguiUrl": "https://apps.example.com/agui",
    "events": [],
    "scopes": ["messages:read", "messages:write", "channels:read", "channels:join"],
}


# ─── the protocol, as arithmetic ──────────────────────────────────────────────
def frame(**event: Any) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode()


def fold_bytes(*chunks: bytes) -> list[agui.Post]:
    """Feed raw bytes through the decoder and the reducer, as the job does."""
    decoder, reducer = sse.SseDecoder(), agui.Fold()
    posts: list[agui.Post] = []
    for chunk in chunks:
        for event in decoder.feed(chunk):
            posts.extend(reducer.feed(event))
    for event in decoder.close():
        posts.extend(reducer.feed(event))
    posts.extend(reducer.finish())
    return posts


def test_a_record_split_across_chunks_is_reassembled() -> None:
    whole = (
        frame(type="TEXT_MESSAGE_START", messageId="m1")
        + frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="hello there")
        + frame(type="TEXT_MESSAGE_END", messageId="m1")
    )

    # One byte at a time: every possible boundary at once.
    posts = fold_bytes(*[whole[i : i + 1] for i in range(len(whole))])
    assert [p.body for p in posts] == ["hello there"]


def test_the_wire_uses_screaming_snake_not_the_docs_headings() -> None:
    # The published docs head each section with the TypeScript interface name
    # (`TextMessageStart`); the discriminator on the wire is `TEXT_MESSAGE_START`.
    # Matching the headings parses nothing at all, silently.
    assert (
        fold_bytes(
            frame(type="TextMessageStart", messageId="m1"),
            frame(type="TextMessageContent", messageId="m1", delta="hi"),
            frame(type="TextMessageEnd", messageId="m1"),
        )
        == []
    )


def test_two_messages_can_interleave() -> None:
    posts = fold_bytes(
        frame(type="TEXT_MESSAGE_START", messageId="a"),
        frame(type="TEXT_MESSAGE_START", messageId="b"),
        frame(type="TEXT_MESSAGE_CONTENT", messageId="a", delta="first"),
        frame(type="TEXT_MESSAGE_CONTENT", messageId="b", delta="second"),
        frame(type="TEXT_MESSAGE_END", messageId="b"),
        frame(type="TEXT_MESSAGE_END", messageId="a"),
    )
    assert [p.body for p in posts] == ["second", "first"]


def test_an_unknown_event_type_does_not_kill_the_run() -> None:
    # The protocol is pre-1.0 and still gaining events. A new one must be inert.
    posts = fold_bytes(
        frame(type="SOMETHING_INVENTED_LATER", payload={"x": 1}),
        frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="still here"),
        frame(type="TEXT_MESSAGE_END", messageId="m1"),
    )
    assert [p.body for p in posts] == ["still here"]


def test_a_stream_that_never_closes_its_message_still_yields_it() -> None:
    # Tolerance over strictness: a producer bug should cost a warning, not the answer.
    posts = fold_bytes(
        frame(type="TEXT_MESSAGE_START", messageId="m1"),
        frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="unterminated"),
    )
    assert [p.body for p in posts] == ["unterminated"]


def test_content_without_a_start_opens_the_message() -> None:
    posts = fold_bytes(
        frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="no start event"),
        frame(type="TEXT_MESSAGE_END", messageId="m1"),
    )
    assert [p.body for p in posts] == ["no start event"]


def test_reasoning_is_never_posted() -> None:
    # An agent's working-out is not its answer, and posting it would be a privacy and a
    # noise problem at once.
    assert (
        fold_bytes(
            frame(type="REASONING_START", messageId="r1"),
            frame(type="REASONING_CONTENT", messageId="r1", delta="let me think"),
            frame(type="REASONING_END", messageId="r1"),
            frame(type="THINKING_TEXT_MESSAGE_CONTENT", delta="hmm"),
        )
        == []
    )


def test_an_empty_delta_is_not_an_empty_message() -> None:
    assert (
        fold_bytes(
            frame(type="TEXT_MESSAGE_START", messageId="m1"),
            frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta=""),
            frame(type="TEXT_MESSAGE_END", messageId="m1"),
        )
        == []
    )


def test_a_long_body_is_split_into_parts_rather_than_truncated() -> None:
    reducer = agui.Fold(max_body_chars=10)
    posts = list(
        reducer.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m", "delta": "a" * 25})
    )
    posts.extend(reducer.finish())

    assert len(posts) > 1
    assert "".join(p.body for p in posts) == "a" * 25
    # Distinct ids, or the second part would dedupe against the first and vanish.
    assert len({p.client_msg_id("run") for p in posts}) == len(posts)


def test_tool_names_become_a_context_block() -> None:
    posts = fold_bytes(
        frame(type="TOOL_CALL_START", toolCallId="t1", toolCallName="search_docs"),
        frame(type="TOOL_CALL_ARGS", toolCallId="t1", delta='{"q":'),
        frame(type="TOOL_CALL_END", toolCallId="t1"),
        frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="found it"),
        frame(type="TEXT_MESSAGE_END", messageId="m1"),
    )
    blocks = posts[0].blocks()
    assert blocks is not None
    assert "search_docs" in blocks[0]["elements"][0]["text"]


def test_a_chunk_event_carries_text_like_the_triad_does() -> None:
    assert [
        p.body
        for p in fold_bytes(
            frame(type="TEXT_MESSAGE_CHUNK", messageId="m1", delta="from a chunk"),
            frame(type="TEXT_MESSAGE_END", messageId="m1"),
        )
    ] == ["from a chunk"]


def test_a_run_error_is_recorded_and_stops_the_run() -> None:
    reducer = agui.Fold()
    reducer.feed({"type": "TEXT_MESSAGE_CONTENT", "messageId": "m", "delta": "partial"})
    posts = reducer.feed({"type": "RUN_ERROR", "message": "the model refused"})

    assert reducer.error == "the model refused"
    assert reducer.finished
    # What arrived before the failure is still worth saying.
    assert [p.body for p in posts] == ["partial"]


def test_an_interrupt_becomes_a_question_not_an_error() -> None:
    reducer = agui.Fold()
    reducer.feed(
        {
            "type": "RUN_FINISHED",
            "outcome": {"type": "interrupt", "interrupts": [{"message": "Deploy to prod?"}]},
        }
    )
    assert reducer.interrupt == "Deploy to prod?"
    assert reducer.error is None


def test_the_run_input_is_camel_case_and_complete() -> None:
    # ag-ui-protocol declares state, tools and forwardedProps as required keys; omitting
    # them is a 422 from every FastAPI-hosted agent, which reads as the agent being down.
    body = agui.build_run_input(
        thread_id="c1", run_id="m1", messages=[], channel_name="general", trigger_user="Ana"
    )
    required = {"threadId", "runId", "state", "messages", "tools", "context", "forwardedProps"}
    assert required <= set(body)


def test_history_casts_the_listening_bot_as_the_assistant() -> None:
    from blob_api.schemas.models import Message

    def message(id_: str, author: str, body: str) -> Message:
        return Message(
            id=id_,
            channel_id="c",
            author_id=author,
            body=body,
            client_msg_id=id_,
            created_at="2026-08-22T10:00:00.000Z",
        )

    out = agui.to_agui_messages(
        [message("1", "person", "hello"), message("2", "bot", "hi back")],
        bot_user_id="bot",
        names={"person": "Ana"},
    )
    assert [entry["role"] for entry in out] == ["user", "assistant"]
    assert out[0]["name"] == "Ana"


# ─── the round trip ───────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _resolve_the_example_host(monkeypatch: pytest.MonkeyPatch) -> None:
    real = net.is_private_host

    async def only_that_host(hostname: str) -> bool:
        return False if hostname == "apps.example.com" else await real(hostname)

    monkeypatch.setattr(net, "is_private_host", only_that_host)


@pytest_asyncio.fixture
async def team(client: Client) -> dict:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    channels = (await owner.get("/api/channels")).body["channels"]
    return {"owner": owner, "member": member, "general": channels[0]["id"]}


async def install(owner: Client, **overrides: object) -> dict:
    response = await owner.post("/api/admin/plugins", {**APP, **overrides})
    assert response.status == 201, response.body
    return response.body


def agent_speaks(
    *chunks: bytes, status: int = 200
) -> tuple[httpx.MockTransport, list[httpx.Request]]:
    """A fake AG-UI agent, plus the requests it was sent."""
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)

        async def stream() -> Any:
            for chunk in chunks:
                yield chunk

        return httpx.Response(
            status, headers={"content-type": "text/event-stream"}, content=stream()
        )

    return httpx.MockTransport(handler), seen


def route_agent_to(monkeypatch: pytest.MonkeyPatch, transport: httpx.MockTransport) -> None:
    real = httpx.AsyncClient

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        kwargs.pop("transport", None)
        return real(**kwargs, transport=transport)

    monkeypatch.setattr(agui_job.httpx, "AsyncClient", fake)


async def join_channel(owner: Client, app_body: dict, channel_id: str) -> Client:
    app_client = owner.fork()
    app_client._http.headers["authorization"] = f"Bearer {app_body['botToken']}"
    app_client._http.cookies.clear()
    joined = await app_client.post("/api/v1/conversations.join", {"channel": channel_id})
    assert joined.status == 200, joined.body
    return app_client


async def messages_in(channel_id: str) -> list[dict]:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT body, kind, client_msg_id FROM messages
                     WHERE channel_id = :c ORDER BY id ASC
                    """
                ),
                {"c": channel_id},
            )
        ).fetchall()
    return [{"body": r.body, "kind": r.kind, "client_msg_id": r.client_msg_id} for r in rows]


ANSWER = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(type="TEXT_MESSAGE_START", messageId="m1"),
    frame(type="TEXT_MESSAGE_CONTENT", messageId="m1", delta="Standup is at nine."),
    frame(type="TEXT_MESSAGE_END", messageId="m1"),
    frame(type="RUN_FINISHED", threadId="t", runId="r"),
)


class TestRoundTrip:
    async def test_a_mention_makes_the_agent_answer_in_the_channel(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, seen = agent_speaks(*ANSWER)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper when is standup?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        bodies = [m["body"] for m in await messages_in(team["general"])]
        assert "Standup is at nine." in bodies
        assert len(seen) == 1

    async def test_running_the_job_twice_posts_one_message(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The claim the whole design rests on: the answer's client_msg_id is derived from
        # the trigger, so a redelivered job cannot say the same thing twice.
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, _ = agent_speaks(*ANSWER)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper when is standup?")
        await agui_job.handle_agui_run(sent.body["message"]["id"])
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        answers = [m for m in await messages_in(team["general"]) if m["kind"] == "bot"]
        assert len(answers) == 1

    async def test_the_request_is_signed_the_way_a_delivery_is(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, seen = agent_speaks(*ANSWER)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper hello")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        request = seen[0]
        assert verify(
            app_body["signingSecret"],
            request.headers.get(TIMESTAMP_HEADER),
            request.headers.get(SIGNATURE_HEADER),
            request.content,
        )

    async def test_the_agent_is_given_the_conversation_oldest_first(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, seen = agent_speaks(*ANSWER)
        route_agent_to(monkeypatch, transport)

        await send_message(team["owner"], team["general"], "first thing")
        sent = await send_message(team["owner"], team["general"], "@Helper second thing")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        body = json.loads(seen[0].content)
        contents = [m["content"] for m in body["messages"]]
        assert contents.index("first thing") < contents.index("@Helper second thing")
        assert body["messages"][0]["role"] == "user"

    async def test_a_bot_message_never_triggers_a_run(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The loop guard, and it is structural: two agents that mention each other cannot
        # converse for ever, because neither one's messages are a trigger.
        app_body = await install(team["owner"])
        app_client = await join_channel(team["owner"], app_body, team["general"])
        transport, seen = agent_speaks(*ANSWER)
        route_agent_to(monkeypatch, transport)

        posted = await app_client.post(
            "/api/v1/chat.postMessage", {"channel": team["general"], "text": "@Helper hello"}
        )
        await agui_job.handle_agui_run(posted.body["message"]["id"])

        assert seen == []

    async def test_a_disabled_app_is_not_called(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        disabled = await team["owner"].post(
            f"/api/admin/plugins/{app_body['plugin']['id']}/enabled", {"enabled": False}
        )
        assert disabled.status == 200, disabled.body
        transport, seen = agent_speaks(*ANSWER)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper hello")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        assert seen == []

    async def test_a_bot_outside_the_channel_says_nothing_at_all(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Not even an error message: a private channel answers 404 so that its existence
        # stays private, and an app announcing "I can't read this" would disclose it.
        await install(team["owner"])
        transport, seen = agent_speaks(*ANSWER)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper hello")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        assert seen == []
        assert [m for m in await messages_in(team["general"]) if m["kind"] == "bot"] == []

    async def test_a_run_error_tells_the_person_and_records_it(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, _ = agent_speaks(
            frame(type="RUN_ERROR", message="the model refused"),
        )
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper hello")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        bodies = [m["body"] for m in await messages_in(team["general"])]
        assert any("couldn't finish" in b for b in bodies)

        async with SessionFactory() as session:
            error = (
                await session.execute(
                    text("SELECT last_error FROM plugins WHERE id = :id"),
                    {"id": app_body["plugin"]["id"]},
                )
            ).scalar_one()
        assert error == "the model refused"

    async def test_a_non_2xx_does_not_raise_into_the_worker(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, _ = agent_speaks(b"", status=500)
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper hello")
        await agui_job.handle_agui_run(sent.body["message"]["id"])  # must not raise

        bodies = [m["body"] for m in await messages_in(team["general"])]
        assert any("500" in b for b in bodies)

    async def test_a_silent_run_posts_nothing(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Silence is a legitimate answer; "the agent had no reply" is worse noise.
        app_body = await install(team["owner"])
        await join_channel(team["owner"], app_body, team["general"])
        transport, _ = agent_speaks(
            frame(type="RUN_STARTED", threadId="t", runId="r"),
            frame(type="RUN_FINISHED", threadId="t", runId="r"),
        )
        route_agent_to(monkeypatch, transport)

        sent = await send_message(team["owner"], team["general"], "@Helper hello")
        await agui_job.handle_agui_run(sent.body["message"]["id"])

        assert [m for m in await messages_in(team["general"]) if m["kind"] == "bot"] == []


class TestRegistration:
    async def test_an_app_with_only_an_agui_url_installs(self, team: dict) -> None:
        body = await install(team["owner"], requestUrl=None)
        assert body["plugin"]["aguiUrl"] == APP["aguiUrl"]

    async def test_an_external_app_with_neither_url_is_refused(self, team: dict) -> None:
        response = await team["owner"].post(
            "/api/admin/plugins", {**APP, "requestUrl": None, "aguiUrl": None}
        )
        assert response.status == 400
        assert response.body["error"]["code"] == "url_required"

    async def test_the_agui_url_goes_through_the_ssrf_guard(self, team: dict) -> None:
        response = await team["owner"].post(
            "/api/admin/plugins",
            {**APP, "requestUrl": None, "aguiUrl": "http://169.254.169.254/latest/meta-data"},
        )
        assert response.status == 400
        assert response.body["error"]["code"] == "bad_request_url"


class TestPrivateEndpoints:
    """An agent one hop away should not need public DNS and a certificate.

    The SSRF guard is right by default: an app URL is operator-supplied and makes *this*
    server issue the request, so a private address is refused. But a self-hosted agent on
    a network only these two containers share is reached the way Postgres and MinIO are,
    and demanding a public hostname for that hop means demanding a working ACME pipeline
    to talk to a neighbour. The relaxation is a setting, so it is a decision somebody made
    rather than a hole somebody found.
    """

    async def test_a_private_endpoint_is_refused_by_default(self, team: dict) -> None:
        response = await team["owner"].post(
            "/api/admin/plugins",
            {**APP, "requestUrl": None, "aguiUrl": "http://janus-agent:8642/v1/agui"},
        )
        assert response.status == 400
        assert response.body["error"]["code"] == "bad_request_url"

    async def test_the_operator_can_allow_one(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.config import settings as app_settings

        monkeypatch.setattr(app_settings, "AGENT_ALLOW_PRIVATE_ENDPOINTS", True)
        # Two switches now: the server's ceiling above, and this workspace's own policy.
        # The operator allowing it globally is no longer the same as allowing it here.
        await allow_policy(await workspace_id_of(team["owner"]))
        response = await team["owner"].post(
            "/api/admin/plugins",
            {**APP, "requestUrl": None, "aguiUrl": "http://janus-agent:8642/v1/agui"},
        )
        assert response.status == 201, response.body
        assert response.body["plugin"]["aguiUrl"] == "http://janus-agent:8642/v1/agui"

    async def test_nonsense_is_still_refused_when_allowed(
        self, team: dict, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Relaxed is not unchecked: a malformed URL is a mistake at any setting.
        from blob_api.config import settings as app_settings

        monkeypatch.setattr(app_settings, "AGENT_ALLOW_PRIVATE_ENDPOINTS", True)
        await allow_policy(await workspace_id_of(team["owner"]))
        for bad in ("not-a-url", "ftp://janus-agent/x", "http://"):
            response = await team["owner"].post(
                "/api/admin/plugins", {**APP, "requestUrl": None, "aguiUrl": bad}
            )
            assert response.status == 400, bad
