"""What happened when an agent was asked something.

A run used to leave no trace but `plugins.last_error`, which the next failure overwrote.
So the three cases people actually need told apart — it failed, it finished cleanly and
said nothing, it never started — looked identical from outside, and the previous failure
was gone as soon as a second one happened.

The four statuses are the point of these tests. Collapsing `interrupted` into `failed`
would hide the one an operator can act on, and calling silence a failure would report a
legitimate answer as a fault.
"""

from __future__ import annotations

from typing import Any

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.jobs import agui as agui_job
from blob_api.plugins import streams
from blob_api.services import agent_runs as agent_run_service

from .helpers import send_message
from .test_agui import (
    ANSWER,
    _resolve_the_example_host,  # noqa: F401 — autouse, needed here too
    agent_speaks,
    frame,
    install,
    join_channel,
    team,  # noqa: F401 — a fixture, used by name
)

# Both fixtures are imported rather than redefined. `_resolve_the_example_host` is autouse
# in its own module and autouse does not cross module boundaries on its own — without it
# here, installing the app is refused by the SSRF guard, since `apps.example.com` resolves
# to something private in this environment.

REFUSAL = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(type="RUN_ERROR", message="the model refused"),
)

NEEDS_A_DECISION = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(
        type="RUN_FINISHED",
        outcome={"type": "interrupt", "interrupts": [{"message": "Deploy to prod?"}]},
    ),
)

SILENCE = (
    frame(type="RUN_STARTED", threadId="t", runId="r"),
    frame(type="RUN_FINISHED", threadId="t", runId="r"),
)


@pytest_asyncio.fixture
async def agent(team: dict, monkeypatch: pytest.MonkeyPatch) -> dict:  # noqa: F811
    """An installed agent in #general, with a swappable answer.

    Patched once, through a mutable slot, rather than per call with
    `test_agui.route_agent_to`. That helper reads `real = httpx.AsyncClient` when it runs,
    and `agui_job.httpx` is the *same module object* — so calling it twice makes the
    second fake wrap the first, and the first transport answers both times. A test that
    asks twice would silently get the first reply for both, which is precisely the bug
    the run log exists to make visible.
    """
    app_body = await install(team["owner"])
    await join_channel(team["owner"], app_body, team["general"])

    slot: dict[str, Any] = {"transport": None}
    real = httpx.AsyncClient

    def fake(**kwargs: Any) -> httpx.AsyncClient:
        kwargs.pop("transport", None)
        return real(**kwargs, transport=slot["transport"])

    monkeypatch.setattr(streams.httpx, "AsyncClient", fake)
    return {"team": team, "app": app_body, "slot": slot}


async def ask(agent: dict, *chunks: bytes, status: int = 200) -> str:
    """Mention the agent, let it answer with `chunks`, and return the trigger id."""
    transport, _ = agent_speaks(*chunks, status=status)
    agent["slot"]["transport"] = transport
    sent = await send_message(agent["team"]["owner"], agent["team"]["general"], "@Helper hi")
    await agui_job.handle_agui_run(sent.body["message"]["id"])
    return str(sent.body["message"]["id"])


async def runs_of(agent: dict) -> list[dict]:
    response = await agent["team"]["owner"].get(
        f"/api/admin/plugins/{agent['app']['plugin']['id']}/runs"
    )
    assert response.status == 200, response.body
    return list(response.body["runs"])


class TestWhatIsRecorded:
    async def test_an_answer_is_recorded_as_succeeded(self, agent: dict) -> None:
        trigger = await ask(agent, *ANSWER)

        [run] = await runs_of(agent)
        assert run["status"] == "succeeded"
        assert run["postCount"] == 1
        assert run["error"] is None
        assert run["triggerMessageId"] == trigger
        assert run["triggerUserName"] == "Owner"
        assert run["transport"] == "http"
        # The one number that says whether an agent is slow, computed here rather than
        # leaving the console to do date arithmetic.
        assert run["durationMs"] is not None

    async def test_a_refusal_is_recorded_with_its_reason(self, agent: dict) -> None:
        await ask(agent, *REFUSAL)

        [run] = await runs_of(agent)
        assert run["status"] == "failed"
        assert run["error"] == "the model refused"

    async def test_an_agent_that_answers_badly_is_recorded(self, agent: dict) -> None:
        await ask(agent, status=500)

        [run] = await runs_of(agent)
        assert run["status"] == "failed"
        assert "500" in (run["error"] or "")

    async def test_needing_a_decision_is_not_a_failure(self, agent: dict) -> None:
        await ask(agent, *NEEDS_A_DECISION)

        [run] = await runs_of(agent)
        # The one an operator can act on. Collapsed into "failed" it would look like the
        # agent broke, when it is waiting for a person.
        assert run["status"] == "interrupted"
        assert run["error"] is None

    async def test_saying_nothing_is_a_success(self, agent: dict) -> None:
        await ask(agent, *SILENCE)

        [run] = await runs_of(agent)
        # `_run_one` treats a clean run with no reply as a legitimate answer and posts
        # nothing. The log has to agree, or every quiet run reads as a fault.
        assert run["status"] == "succeeded"
        assert run["postCount"] == 0


class TestTheLog:
    async def test_the_newest_run_is_first(self, agent: dict) -> None:
        await ask(agent, *ANSWER)
        await ask(agent, *REFUSAL)

        runs = await runs_of(agent)
        assert [r["status"] for r in runs] == ["failed", "succeeded"]

    async def test_a_run_outlives_the_message_that_started_it(self, agent: dict) -> None:
        trigger = await ask(agent, *REFUSAL)
        owner = agent["team"]["owner"]
        assert (await owner.delete(f"/api/messages/{trigger}")).status == 200

        # SET NULL rather than CASCADE: deleting the message must not delete the evidence
        # that a run happened, which is the only thing that can explain the silence.
        [run] = await runs_of(agent)
        assert run["status"] == "failed"

    async def test_a_member_cannot_read_it(self, agent: dict) -> None:
        response = await agent["team"]["member"].get(
            f"/api/admin/plugins/{agent['app']['plugin']['id']}/runs"
        )
        assert response.status == 403


class TestRetention:
    async def test_a_run_that_never_finished_is_closed(self, agent: dict) -> None:
        await ask(agent, *ANSWER)
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text(
                        """
                        UPDATE agent_runs
                           SET status = 'running', finished_at = NULL,
                               started_at = now() - interval '2 hours'
                        """
                    )
                )
                await agent_run_service.sweep(session)

        [run] = await runs_of(agent)
        # A process killed mid-call leaves a `running` row. One that still claims to be
        # going is worse than one that admits it never finished.
        assert run["status"] == "failed"
        assert run["error"] == "that run never finished"

    async def test_old_runs_are_dropped(self, agent: dict) -> None:
        await ask(agent, *ANSWER)
        async with SessionFactory() as session:
            async with session.begin():
                await session.execute(
                    text("UPDATE agent_runs SET started_at = now() - interval '90 days'")
                )
                removed = await agent_run_service.sweep(session)

        # Every mention writes a row and nothing else would ever remove one.
        assert removed == 1
        assert await runs_of(agent) == []
