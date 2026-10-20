"""Cost you can see (M2 · A9): tokens from both sources, prices a workspace sets, a daily
token cap, and who may read what.

What is pinned is the arithmetic and its honesty — a model nobody priced leaves the cost
partial rather than zero, an entry that gave only a total is counted but not priced — and
the boundaries: an owner reads their own agents and nothing else, a member reads nothing
of the workspace's bill.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.config import settings
from blob_api.db.engine import SessionFactory
from blob_api.lib import llm
from blob_api.lib.ids import new_id
from blob_api.services import agent_runs as agent_run_service
from blob_api.services import usage as usage_service

from .helpers import Client, invite_and_sign_up, sign_up
from .test_agui import (
    _resolve_the_example_host,  # noqa: F401 — autouse there, needed here
    install,
)
from .test_summary_model import completes, thread
from .test_summary_model import model as _model_fixture

model = _model_fixture

CLAUDE = "claude-sonnet-5"
GPT = "gpt-5"


@pytest_asyncio.fixture
async def team(client: Client) -> dict[str, Any]:
    owner = await sign_up(client, "Owner")
    member = await invite_and_sign_up(owner, "Member")
    general = (await owner.get("/api/channels")).body["channels"][0]["id"]
    shared = (await install(owner))["plugin"]["id"]
    return {"owner": owner, "member": member, "general": general, "shared": shared}


async def a_run(
    plugin_id: str,
    channel_id: str,
    usage: list[dict[str, Any]] | None,
    *,
    by: str | None = None,
    hours_ago: float = 1,
    status: str = "succeeded",
) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            workspace = (
                await session.execute(
                    text("SELECT workspace_id FROM plugins WHERE id = :id"), {"id": plugin_id}
                )
            ).scalar_one()
            await session.execute(
                text(
                    """
                    INSERT INTO agent_runs
                      (id, workspace_id, plugin_id, channel_id, transport, status, chain_id,
                       usage, initiated_by_user_id, started_at, finished_at)
                    VALUES (:id, :ws, :p, :c, 'http', :status, :id, cast(:usage AS jsonb),
                            cast(:by AS uuid), now() - make_interval(secs => :ago),
                            now() - make_interval(secs => :ago))
                    """
                ),
                {
                    "id": new_id(),
                    "ws": workspace,
                    "p": plugin_id,
                    "c": channel_id,
                    "status": status,
                    "usage": json.dumps(usage) if usage is not None else None,
                    "by": by,
                    "ago": hours_ago * 3600,
                },
            )


async def personal_agent(owner: Client, plugin_id: str) -> None:
    async with SessionFactory() as session:
        async with session.begin():
            await session.execute(
                text("UPDATE plugins SET owner_user_id = :u WHERE id = :id"),
                {"u": owner.user_id, "id": plugin_id},
            )


def line(lines: list[dict[str, Any]], name: str) -> dict[str, Any]:
    return next(entry for entry in lines if entry["name"] == name)


# ─── the arithmetic ──────────────────────────────────────────────────────────────────


class TestPricing:
    def test_tokens_times_price_model_by_model(self) -> None:
        prices = usage_service.Prices(
            currency="EUR",
            by_model={
                CLAUDE: usage_service.Price(usage_service.Decimal(3), usage_service.Decimal(15))
            },
        )
        spend = usage_service.Spend(input=1_000_000, output=100_000, total=1_100_000)
        cost, complete = usage_service.cost_of([(CLAUDE, spend)], prices)
        assert cost == usage_service.Decimal("4.5")
        assert complete is True

    def test_an_unpriced_model_or_a_bare_total_leaves_the_cost_partial(self) -> None:
        prices = usage_service.Prices(
            currency="EUR",
            by_model={
                CLAUDE: usage_service.Price(usage_service.Decimal(3), usage_service.Decimal(15))
            },
        )
        priced = usage_service.Spend(input=1_000_000, total=1_000_000)
        other = usage_service.Spend(input=10, output=10, total=20)
        cost, complete = usage_service.cost_of([(CLAUDE, priced), (GPT, other)], prices)
        assert cost == usage_service.Decimal(3)
        assert complete is False

        bare = usage_service.Spend(total=500, unsplit=500)
        cost, complete = usage_service.cost_of([(CLAUDE, bare)], prices)
        assert cost == 0
        assert complete is False

        nothing, complete = usage_service.cost_of([(GPT, other)], prices)
        assert nothing is None
        assert complete is False


# ─── the admin's page ────────────────────────────────────────────────────────────────


class TestTheReport:
    async def test_agents_people_and_models_with_what_each_cost(self, team: dict[str, Any]) -> None:
        owner, member = team["owner"], team["member"]
        mine = (await install(owner, slug="scout", name="Scout"))["plugin"]["id"]
        await personal_agent(member, mine)
        await a_run(
            team["shared"],
            team["general"],
            [{"model": CLAUDE, "inputTokens": 1_000_000, "outputTokens": 100_000}],
            by=owner.user_id,
        )
        await a_run(
            mine,
            team["general"],
            [
                {"model": CLAUDE, "inputTokens": 200_000, "outputTokens": 0},
                {"model": GPT, "totalTokens": 3_000},
            ],
            by=member.user_id,
        )
        # Outside the window, and a refusal: neither counts.
        await a_run(
            team["shared"], team["general"], [{"model": CLAUDE, "inputTokens": 9}], hours_ago=200
        )
        await a_run(team["shared"], team["general"], None, status="refused")

        saved = await owner.request(
            "PUT",
            "/api/admin/usage/prices",
            {
                "currency": "EUR",
                "prices": [{"model": CLAUDE, "inputPerMillion": 3, "outputPerMillion": 15}],
            },
        )
        assert saved.status == 200, saved.body
        report = await owner.get("/api/admin/usage?days=7")
        assert report.status == 200, report.body
        body = report.body
        assert body["currency"] == "EUR"

        shared = line(body["agents"], "Helper")
        assert shared["runs"] == 1
        assert shared["tokens"] == 1_100_000
        assert shared["cost"] == pytest.approx(4.5)
        assert shared["costComplete"] is True

        scout = line(body["agents"], "Scout")
        assert scout["ownerName"] == "Member"
        assert scout["tokens"] == 203_000
        assert scout["cost"] == pytest.approx(0.6)
        assert scout["costComplete"] is False, "GPT is unpriced and gave only a total"

        assert line(body["people"], "Owner")["tokens"] == 1_100_000
        assert line(body["people"], "Member")["tokens"] == 203_000

        models = {entry["model"]: entry for entry in body["models"]}
        assert models[CLAUDE]["inputPerMillion"] == 3
        assert models[GPT]["inputPerMillion"] is None
        assert models[GPT]["tokens"] == 3_000

        day = await owner.get("/api/admin/usage?days=1")
        assert line(day.body["agents"], "Helper")["tokens"] == 1_100_000
        month = await owner.get("/api/admin/usage?days=30")
        assert line(month.body["agents"], "Helper")["tokens"] == 1_100_009

    async def test_only_the_three_windows(self, team: dict[str, Any]) -> None:
        refused = await team["owner"].get("/api/admin/usage?days=3")
        assert refused.status == 400
        assert refused.body["error"]["code"] == "invalid_input"

    async def test_the_bill_is_an_admins(self, team: dict[str, Any]) -> None:
        assert (await team["member"].get("/api/admin/usage")).status == 403
        put = await team["member"].request(
            "PUT", "/api/admin/usage/prices", {"currency": "EUR", "prices": []}
        )
        assert put.status == 403

    async def test_prices_are_checked_and_replaced_whole(self, team: dict[str, Any]) -> None:
        owner = team["owner"]
        for bad in (
            {"currency": "euro", "prices": []},
            {
                "currency": "EUR",
                "prices": [{"model": CLAUDE, "inputPerMillion": -1, "outputPerMillion": 1}],
            },
            {
                "currency": "EUR",
                "prices": [{"model": "", "inputPerMillion": 1, "outputPerMillion": 1}],
            },
        ):
            refused = await owner.request("PUT", "/api/admin/usage/prices", bad)
            assert refused.status == 400, bad

        await owner.request(
            "PUT",
            "/api/admin/usage/prices",
            {
                "currency": "USD",
                "prices": [{"model": GPT, "inputPerMillion": 1.25, "outputPerMillion": 10}],
            },
        )
        await owner.request("PUT", "/api/admin/usage/prices", {"currency": "USD", "prices": []})
        kept = await owner.get("/api/admin/usage/prices")
        assert kept.body == {"currency": "USD", "prices": []}
        async with SessionFactory() as session:
            actions = (
                await session.execute(
                    text("SELECT count(*) FROM audit_events WHERE action = 'usage.prices_set'")
                )
            ).scalar_one()
        assert actions == 2

    async def test_a_row_written_by_anything_else_cannot_break_the_page(
        self, team: dict[str, Any]
    ) -> None:
        await a_run(
            team["shared"],
            team["general"],
            [{"totalTokens": "lots"}, {"inputTokens": 5, "outputTokens": "x"}, "nonsense"],
        )
        report = await team["owner"].get("/api/admin/usage")
        assert report.status == 200, report.body
        assert line(report.body["agents"], "Helper")["tokens"] == 5


class TestAnOwnersView:
    async def test_their_own_agents_and_nothing_else(self, team: dict[str, Any]) -> None:
        owner, member = team["owner"], team["member"]
        mine = (await install(owner, slug="scout", name="Scout"))["plugin"]["id"]
        await personal_agent(member, mine)
        await a_run(mine, team["general"], [{"model": CLAUDE, "inputTokens": 40}], by=owner.user_id)
        await a_run(team["shared"], team["general"], [{"model": CLAUDE, "inputTokens": 99}])

        seen = await member.get("/api/agents/usage?days=7")
        assert seen.status == 200, seen.body
        assert [entry["name"] for entry in seen.body["agents"]] == ["Scout"]
        # Whoever asked it — the owner lent it — the spend is the agent's owner's to see.
        assert seen.body["agents"][0]["tokens"] == 40
        assert seen.body["people"] == []
        assert seen.body["blob"] == []
        assert [entry["model"] for entry in seen.body["models"]] == [CLAUDE]

        nothing = await owner.get("/api/agents/usage")
        assert nothing.body["agents"] == []


# ─── Blob's own model ────────────────────────────────────────────────────────────────


class TestBlobsOwnCalls:
    async def test_a_summary_is_counted_against_the_workspace(
        self, client: Client, model: dict[str, Any], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_MODEL", None)
        t = await thread(client)
        made = await t["member"].post(f"/api/threads/{t['root']['id']}/summary")
        assert made.status == 200, made.body

        async with SessionFactory() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT feature, model, input_tokens, output_tokens, user_id"
                        " FROM model_calls"
                    )
                )
            ).one()
        assert (row.feature, row.model, row.input_tokens, row.output_tokens) == (
            "summary",
            llm.DEFAULT_MODELS["anthropic"],
            10,
            5,
        )
        assert str(row.user_id) == t["member"].user_id

        report = await t["owner"].get("/api/admin/usage")
        summary = line(report.body["blob"], "summary")
        assert (summary["runs"], summary["tokens"]) == (1, 15)
        assert summary["cost"] is None

    async def test_a_failed_summary_was_still_paid_for(
        self, client: Client, model: dict[str, Any]
    ) -> None:
        model["transport"], _ = completes("{}", stop_reason="max_tokens")
        t = await thread(client)
        failed = await t["member"].post(f"/api/threads/{t['root']['id']}/summary")
        assert failed.status == 502
        async with SessionFactory() as session:
            spent = (
                await session.execute(text("SELECT input_tokens + output_tokens FROM model_calls"))
            ).scalar_one()
        assert spent == 15

    async def test_the_keyword_scan_costs_nothing_and_writes_nothing(
        self, client: Client, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "LLM_PROVIDER", "disabled")
        t = await thread(client)
        assert (await t["member"].post(f"/api/threads/{t['root']['id']}/summary")).status == 200
        async with SessionFactory() as session:
            assert (await session.execute(text("SELECT count(*) FROM model_calls"))).scalar() == 0


class TestTheMeter:
    def anthropic_stream(self) -> httpx.MockTransport:
        events = [
            {
                "type": "message_start",
                "message": {"usage": {"input_tokens": 120, "output_tokens": 1}},
            },
            {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Hello"}},
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": 30},
            },
            {"type": "message_stop"},
        ]
        body = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
        return httpx.MockTransport(
            lambda request: httpx.Response(
                200, content=body.encode(), headers={"content-type": "text/event-stream"}
            )
        )

    async def test_anthropic_counts_arrive_in_pieces(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "LLM_PROVIDER", "anthropic")
        monkeypatch.setattr(settings, "LLM_API_KEY", "k")
        transport = self.anthropic_stream()
        monkeypatch.setattr(llm, "open_client", lambda: httpx.AsyncClient(transport=transport))
        meter = llm.Meter()
        said = "".join(
            [
                d
                async for d in llm.stream_reply(
                    system="s", turns=[llm.Turn("user", "hi")], meter=meter
                )
            ]
        )
        assert said == "Hello"
        assert (meter.input_tokens, meter.output_tokens) == (120, 30)

    @pytest.mark.parametrize("base", [None, "https://compatible.example.com"])
    async def test_openai_is_asked_for_its_counts_only_where_that_is_safe(
        self, monkeypatch: pytest.MonkeyPatch, base: str | None
    ) -> None:
        monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
        monkeypatch.setattr(settings, "LLM_API_KEY", "k")
        monkeypatch.setattr(settings, "LLM_BASE_URL", base)
        sent: list[dict[str, Any]] = []
        chunks = [
            {"choices": [{"delta": {"content": "Hi"}}]},
            {"choices": [], "usage": {"prompt_tokens": 50, "completion_tokens": 7}},
        ]
        body = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"

        def handler(request: httpx.Request) -> httpx.Response:
            sent.append(json.loads(request.content))
            return httpx.Response(
                200, content=body.encode(), headers={"content-type": "text/event-stream"}
            )

        monkeypatch.setattr(
            llm, "open_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
        )
        meter = llm.Meter()
        said = "".join(
            [
                d
                async for d in llm.stream_reply(
                    system="s", turns=[llm.Turn("user", "hi")], meter=meter
                )
            ]
        )
        assert said == "Hi"
        assert ("stream_options" in sent[0]) is (base is None)
        # A server that sends the counts anyway is still read.
        assert (meter.input_tokens, meter.output_tokens) == (50, 7)


# ─── the token cap ───────────────────────────────────────────────────────────────────


class TestTheTokenCap:
    async def test_it_is_set_shown_and_lifted(self, team: dict[str, Any]) -> None:
        owner = team["owner"]
        set_ = await owner.post(
            f"/api/admin/plugins/{team['shared']}/budget",
            {"runsPerDay": None, "secondsPerDay": None, "tokensPerDay": 50_000},
        )
        assert set_.status == 200, set_.body
        assert set_.body["budgetTokensPerDay"] == 50_000
        zero = await owner.post(f"/api/admin/plugins/{team['shared']}/budget", {"tokensPerDay": 0})
        assert zero.status == 400
        lifted = await owner.post(
            f"/api/admin/plugins/{team['shared']}/budget", {"tokensPerDay": None}
        )
        assert lifted.body["budgetTokensPerDay"] is None

    async def test_an_agent_over_its_reported_tokens_is_refused(self, team: dict[str, Any]) -> None:
        await team["owner"].post(
            f"/api/admin/plugins/{team['shared']}/budget", {"tokensPerDay": 1_000}
        )
        async with SessionFactory() as session:
            assert await agent_run_service.check_budget(session, plugin_id=team["shared"]) is None
        await a_run(team["shared"], team["general"], [{"inputTokens": 900, "outputTokens": 100}])
        async with SessionFactory() as session:
            reason = await agent_run_service.check_budget(session, plugin_id=team["shared"])
        assert reason == "Daily budget reached: 1,000 tokens in the last 24 hours."

    async def test_tokens_from_yesterday_and_an_agent_that_reports_none_do_not_count(
        self, team: dict[str, Any]
    ) -> None:
        await team["owner"].post(
            f"/api/admin/plugins/{team['shared']}/budget", {"tokensPerDay": 1_000}
        )
        await a_run(team["shared"], team["general"], [{"inputTokens": 5_000}], hours_ago=30)
        await a_run(team["shared"], team["general"], None)
        async with SessionFactory() as session:
            assert await agent_run_service.check_budget(session, plugin_id=team["shared"]) is None
