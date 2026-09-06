"""Model-written thread summaries: cited, bounded, and honest about failing.

The provider is faked at the transport `lib/llm.py` owns (`open_client`), never at
`httpx.AsyncClient` — see the `model` fixture in test_builtin_agent for why. The fake
answers whole (no stream), which is the call `complete` makes, and records every request
body so the tests can pin what the model is shown and asked for.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.lib import llm
from blob_api.schemas.models import Message
from blob_api.services import agentic as agentic_service

from .helpers import Client, invite_and_sign_up, send_message, sign_up

GOOD = {
    "overview": "The team agreed to ship the handoff on Monday. Member owns the rollout "
    "checklist; nobody has taken the announcement.",
    "decisions": [{"text": "Ship the handoff on Monday", "sources": [2]}],
    "action_items": [{"text": "Own the rollout checklist", "owner": "Member", "sources": [2]}],
    "open_questions": [{"text": "Who handles the announcement?", "sources": [3]}],
}


def completes(
    payload: dict[str, Any] | str,
    *,
    stop_reason: str = "end_turn",
    first_status: int = 200,
    first_body: bytes = b"",
) -> tuple[httpx.MockTransport, list[dict[str, Any]]]:
    """A fake Anthropic `/v1/messages` that answers whole and records each request."""
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        if first_status >= 400 and len(seen) == 1:
            return httpx.Response(first_status, content=first_body)
        text_out = payload if isinstance(payload, str) else json.dumps(payload)
        return httpx.Response(
            200,
            json={
                "type": "message",
                "role": "assistant",
                "content": [{"type": "text", "text": text_out}],
                "stop_reason": stop_reason,
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        )

    return httpx.MockTransport(handler), seen


@pytest.fixture
def model(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
    monkeypatch.setattr(settings, "LLM_API_KEY", "test-key")
    transport, seen = completes(GOOD)
    slot: dict[str, Any] = {"transport": transport, "seen": seen}
    monkeypatch.setattr(llm, "open_client", lambda: httpx.AsyncClient(transport=slot["transport"]))
    return slot


async def thread(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    root = (await send_message(owner, general, "Should we ship the handoff on Monday?")).body[
        "message"
    ]
    first = (
        await send_message(
            member, general, "Yes, I will own the rollout checklist.", threadRootId=root["id"]
        )
    ).body["message"]
    second = (
        await send_message(
            owner, general, "Great. Who handles the announcement?", threadRootId=root["id"]
        )
    ).body["message"]
    return {"owner": owner, "member": member, "root": root, "first": first, "second": second}


class TestTheModelPath:
    async def test_the_model_writes_it_and_the_ids_are_resolved_here(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 200, response.body
        summary = response.body["summary"]
        assert summary["provider"] == "llm:claude-sonnet-5"
        assert summary["overview"].startswith("The team agreed")
        assert summary["decisions"] == [
            {"text": "Ship the handoff on Monday", "messageId": t["first"]["id"]}
        ]
        assert summary["actionItems"] == [
            {
                "text": "Own the rollout checklist",
                "assigneeUserId": t["member"].user_id,
                "sourceMessageId": t["first"]["id"],
            }
        ]
        assert summary["openQuestions"] == [
            {
                "text": "Who handles the announcement?",
                "messageId": t["second"]["id"],
                "askedByUserId": t["owner"].user_id,
            }
        ]
        assert summary["messageCount"] == 3

        # What the model was shown and asked for.
        (request,) = model["seen"]
        assert "stream" not in request
        assert request["max_tokens"] == agentic_service.MAX_OUTPUT_TOKENS
        assert request["output_config"]["format"]["type"] == "json_schema"
        assert "JSON" in request["system"]
        transcript = request["messages"][0]["content"]
        assert "[1] Owner: Should we ship the handoff on Monday?" in transcript
        assert "[2] Member: Yes, I will own the rollout checklist." in transcript
        assert "[3] Owner: Great. Who handles the announcement?" in transcript

        audit = await t["owner"].get("/api/admin/audit?action=agent.summary_generated")
        assert audit.body["events"][0]["metadata"]["provider"] == "llm:claude-sonnet-5"

    async def test_a_model_that_cites_some_lines_loses_the_uncited_ones(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        model["transport"], model["seen"] = completes(
            {
                **GOOD,
                "decisions": [
                    {"text": "Ship on Monday", "sources": [2]},
                    {"text": "Rewrite everything in Rust", "sources": []},
                    {"text": "Cites a message that is not there", "sources": [99]},
                ],
            }
        )
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 200
        assert [d["text"] for d in response.body["summary"]["decisions"]] == ["Ship on Monday"]

    async def test_a_model_citing_only_numbers_that_are_not_there_loses_those_lines(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        model["transport"], model["seen"] = completes(
            {
                **GOOD,
                "decisions": [{"text": "Invented, with a fake source", "sources": [42]}],
                "action_items": [],
                "open_questions": [],
            }
        )
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 200
        assert response.body["summary"]["decisions"] == []

    async def test_a_thread_with_nothing_to_show_a_model_gets_the_keyword_scan(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        owner = await sign_up(client, "Owner")
        general = (await owner.get("/api/channels")).body["channels"][0]["id"]
        root = (await send_message(owner, general, "Deleting this one.")).body["message"]
        assert (await owner.delete(f"/api/messages/{root['id']}")).status == 200
        response = await owner.post(f"/api/threads/{root['id']}/summary")
        assert response.status == 200, response.body
        assert response.body["summary"]["provider"] == "heuristic-v1"
        assert model["seen"] == []

    async def test_a_model_that_never_cites_keeps_its_lines_uncited(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        model["transport"], model["seen"] = completes(
            {
                "overview": "A plain summary from a server that ignored the schema.",
                "decisions": [{"text": "Ship on Monday", "sources": []}],
                "action_items": [],
                "open_questions": [{"text": "Who announces?", "sources": []}],
            }
        )
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 200
        summary = response.body["summary"]
        assert summary["decisions"] == [{"text": "Ship on Monday", "messageId": None}]
        assert summary["openQuestions"] == [
            {"text": "Who announces?", "messageId": None, "askedByUserId": None}
        ]

    async def test_garbage_is_a_typed_error_and_the_old_summary_stays(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        first = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert first.status == 200

        model["transport"], model["seen"] = completes("Sorry, I cannot do that today.")
        again = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert again.status == 502
        assert again.body["error"]["code"] == "llm_failed"
        assert "expected shape" in again.body["error"]["message"]

        kept = await t["owner"].get(f"/api/threads/{t['root']['id']}/summary")
        assert kept.body["summary"]["overview"] == first.body["summary"]["overview"]

    async def test_running_out_of_room_is_a_typed_error(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        model["transport"], model["seen"] = completes(GOOD, stop_reason="max_tokens")
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 502
        assert response.body["error"]["code"] == "llm_failed"
        assert "ran out of room" in response.body["error"]["message"]

    async def test_a_provider_that_refuses_the_schema_hint_is_asked_once_more_without_it(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        model["transport"], model["seen"] = completes(
            GOOD,
            first_status=400,
            first_body=b'{"error":{"message":"output_config.format is not supported"}}',
        )
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 200, response.body
        first, second = model["seen"]
        assert "output_config" in first
        assert "output_config" not in second

    async def test_a_provider_error_that_is_not_about_the_hint_is_not_retried(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        t = await thread(client)
        model["transport"], model["seen"] = completes(
            GOOD, first_status=402, first_body=b'{"error":{"message":"no credit"}}'
        )
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 502
        assert "402" in response.body["error"]["message"]
        assert len(model["seen"]) == 1

    async def test_model_summaries_are_metered(self, client: Client, model: dict[str, Any]) -> None:
        t = await thread(client)
        for _ in range(10):
            assert (await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")).status == 200
        eleventh = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert eleventh.status == 429
        assert eleventh.body["error"]["code"] == "rate_limited"

    async def test_an_app_gets_the_same_summary(
        self, client: Client, model: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from blob_api.lib import net

        from .test_agentic import APP_WITH_AGENTIC, bot_client, install

        # The manifest's callback host is a fixture of the agentic tests; resolving it for
        # real is what the SSRF guard would otherwise do, so it is answered here instead.
        real = net.is_private_host

        async def only_that_host(hostname: str) -> bool:
            return False if hostname == "apps.example.com" else await real(hostname)

        monkeypatch.setattr(net, "is_private_host", only_that_host)

        t = await thread(client)
        installed = await install(t["owner"], APP_WITH_AGENTIC)
        bot = bot_client(t["owner"], installed["botToken"])
        response = await bot.post("/api/v1/threads.summarize", {"messageId": t["root"]["id"]})
        assert response.status == 200, response.body
        assert response.body["summary"]["provider"] == "llm:claude-sonnet-5"


class TestWithoutAModel:
    async def test_the_keyword_scan_still_runs_and_questions_point_at_their_message(
        self, client: Client
    ) -> None:
        t = await thread(client)
        response = await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        assert response.status == 200
        summary = response.body["summary"]
        assert summary["provider"] == "heuristic-v1"
        assert summary["openQuestions"][0] == {
            "text": "Should we ship the handoff on Monday?",
            "messageId": t["root"]["id"],
            "askedByUserId": t["owner"].user_id,
        }

    async def test_a_summary_stored_before_questions_had_ids_still_reads(
        self, client: Client
    ) -> None:
        t = await thread(client)
        await t["owner"].post(f"/api/threads/{t['root']['id']}/summary")
        async with SessionFactory() as session, session.begin():
            await session.execute(
                text(
                    "UPDATE thread_summaries SET open_questions = '[\"Who?\"]'::jsonb "
                    "WHERE thread_root_id = :root"
                ),
                {"root": t["root"]["id"]},
            )
        fetched = await t["owner"].get(f"/api/threads/{t['root']['id']}/summary")
        assert fetched.body["summary"]["openQuestions"] == [
            {"text": "Who?", "messageId": None, "askedByUserId": None}
        ]


def _message(number: int, body: str, author: str = "u1") -> Message:
    return Message(
        id=f"0199{number:032x}"[:36],
        channel_id="c",
        author_id=author,
        body=body,
        client_msg_id=f"m{number}",
        created_at="2026-09-05T00:00:00.000Z",
    )


class TestTheTranscript:
    def test_a_long_thread_keeps_the_root_and_the_recent_and_says_what_it_skipped(self) -> None:
        messages = [_message(n, f"message {n}") for n in range(200)]
        numbered, body = agentic_service.transcript(messages, {"u1": "Ana"})
        assert len(numbered) == agentic_service.MAX_MESSAGES
        assert numbered[0][1].body == "message 0"
        assert numbered[-1][1].body == "message 199"
        assert "80 messages from the middle of the thread omitted" in body
        assert body.startswith("[1] Ana: message 0")

    def test_a_pasted_log_is_clipped_and_system_rows_are_skipped(self) -> None:
        messages = [
            _message(1, "x" * 5000),
            Message(
                id="0199" + "0" * 32,
                channel_id="c",
                author_id=None,
                kind="system",
                body="Ana joined",
                client_msg_id="s",
                created_at="2026-09-05T00:00:00.000Z",
            ),
        ]
        numbered, body = agentic_service.transcript(messages, {})
        assert len(numbered) == 1
        assert body.endswith("…")
        assert len(body) < agentic_service.MAX_MESSAGE_CHARS + 20
        assert "someone:" in body
