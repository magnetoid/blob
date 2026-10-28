"""An agent coming back to a conversation later (ADR 0040).

`schedule_followup` is a run waiting until a time, the way a run waits on another agent's
answer (M2 · A2). These pin that it waits holding nothing and says when, that only its
time wakes it — never the question's nets — that it carries on once, in the same place and
on the same person's authority, that what it may ask for is bounded, that a wait of days
asks again on waking whether the person still may, and that Stop and the nightly sweep
treat it like any waiting run.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import text

from blob_api.db.engine import SessionFactory, transaction
from blob_api.jobs import agui as agui_job
from blob_api.jobs import agui_later, agui_outcome, agui_tools
from blob_api.services import agent_runs as agent_run_service

from .helpers import send_message
from .test_agent_tools import calls, says
from .test_agui import _resolve_the_example_host  # noqa: F401 — autouse where it is defined
from .test_ask_agent import (  # noqa: F401 — `pair` is a fixture, found by its name here
    all_runs,
    ask_helper,
    bodies,
    pair,
    settle,
    tool_results,
)


def later(**delta: float) -> str:
    return (datetime.now(UTC) + timedelta(**delta)).isoformat()


def follow_up(when: str, note: str = "check whether the deploy went out") -> bytes:
    return calls(("c1", "schedule_followup", {"when": when, "note": note}))


async def helper_runs() -> list[Any]:
    return [run for run in await all_runs() if run.name == "Helper"]


async def run_row(run_id: Any) -> Any:
    async with SessionFactory() as session:
        return (
            await session.execute(
                text("SELECT status, error, answered_at FROM agent_runs WHERE id = :id"),
                {"id": run_id},
            )
        ).first()


async def execute(sql: str, **params: Any) -> None:
    async with SessionFactory() as session:
        await session.execute(text(sql), params)
        await session.commit()


async def bring_forward(run_id: Any) -> None:
    """Its time has come — what an hour or a fortnight would do, without the wait."""
    await execute(
        """
        UPDATE agent_runs
           SET interrupt = jsonb_set(interrupt, '{comes_back,until}', to_jsonb(CAST(:past AS text)))
         WHERE id = :id
        """,
        id=run_id,
        past=(datetime.now(UTC) - timedelta(seconds=5)).isoformat(),
    )


async def wake(held: dict[str, Any]) -> int:
    woke = await agui_job.resume_waiting_runs()
    await settle(held)
    return woke


def asked_times(held: dict[str, Any]) -> int:
    return len(held["state"]["seen"].get("/agui", []))


class TestWaiting:
    async def test_it_waits_holding_nothing_and_its_card_says_when_and_why(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        when = later(hours=2)
        await ask_helper(pair, "@Helper tell me when the deploy is out", agui=[follow_up(when)])

        [run] = await helper_runs()
        assert run.status == "waiting"
        assert run.interrupt["kind"] == agui_later.KIND
        async with SessionFactory() as session:
            view = await agent_run_service.view_of(session, str(run.id))
        assert view is not None
        assert view["comesBackFor"] == "check whether the deploy went out"
        # The client's timestamp format, and the moment the agent named.
        assert view["comesBackAt"].endswith("Z")
        said = datetime.fromisoformat(view["comesBackAt"].replace("Z", "+00:00"))
        assert abs((said - datetime.fromisoformat(when)).total_seconds()) < 1

        # Asked once, and nothing wakes it before its time.
        assert asked_times(pair) == 1
        assert await agui_job.resume_waiting_runs() == 0

    async def test_the_questions_nets_never_wake_it_early(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        """Past the chain's quarter-hour wall and the hop's grace, both of which would end
        a question to another agent: a follow-up names no hop, so "no hop yet" is always
        true of it, and only its own time may wake it."""
        await ask_helper(pair, "@Helper look again on Monday", agui=[follow_up(later(days=3))])
        [run] = await helper_runs()
        await execute(
            "UPDATE agent_runs SET finished_at = now() - interval '2 hours' WHERE id = :id",
            id=run.id,
        )
        assert await agui_job.resume_waiting_runs() == 0
        assert asked_times(pair) == 1

    async def test_handed_on_early_it_goes_back_to_sleep(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        """`agent_heard` is enqueued by more than the clock — an asked agent's finish hands
        on whatever waits on it — so the run itself checks its time, not only the cron."""
        await ask_helper(pair, "@Helper look again tomorrow", agui=[follow_up(later(days=1))])
        [run] = await helper_runs()

        await agui_job.handle_agent_heard(str(run.id))
        await settle(pair)

        assert (await run_row(run.id)).status == "waiting"
        assert asked_times(pair) == 1


class TestComingBack:
    async def test_at_its_time_it_carries_on_where_it_was_for_the_same_person(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        await ask_helper(
            pair,
            "@Helper tell me when the deploy is out",
            agui=[follow_up(later(hours=2)), says("The deploy is out.")],
        )
        [waiting] = await helper_runs()
        await bring_forward(waiting.id)

        assert await wake(pair) == 1

        # Handed its note as the call's result, with what was said since.
        result = tool_results(pair)[-1]
        assert result.startswith("It is time to come back to this conversation.")
        assert "check whether the deploy went out" in result
        first, resumed = await helper_runs()
        assert first.status == "succeeded" and first.answered_at is not None
        assert resumed.parent_run_id == first.id
        assert resumed.chain_id == first.chain_id
        assert resumed.initiated_by_user_id == first.initiated_by_user_id
        assert ("Helper", "The deploy is out.") in await bodies(pair)

        # Once.
        assert await agui_job.resume_waiting_runs() == 0
        assert asked_times(pair) == 2

    async def test_a_worker_lost_between_hearing_and_starting_loses_nothing(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """The run that waited used to be written `succeeded` in one transaction and its
        continuation started after the commit. A worker restarted between the two — a
        deploy does that on every push — left the parent answered and nothing carrying
        on, and no net picks up a run that is not `waiting`."""
        await ask_helper(
            pair,
            "@Helper tell me when the deploy is out",
            agui=[follow_up(later(hours=2)), says("The deploy is out.")],
        )
        [waiting] = await helper_runs()
        await bring_forward(waiting.id)

        async def lost(*args: Any, **kwargs: Any) -> None:
            return None  # the process died here

        run_one = agui_job.run_one
        monkeypatch.setattr(agui_job, "run_one", lost)
        await wake(pair)
        assert (await run_row(waiting.id)).status == "waiting", "still to be carried on"
        assert len(await helper_runs()) == 1

        monkeypatch.setattr(agui_job, "run_one", run_one)
        assert await wake(pair) == 1
        first, resumed = await helper_runs()
        assert first.status == "succeeded" and first.answered_at is not None
        assert resumed.parent_run_id == first.id
        assert ("Helper", "The deploy is out.") in await bodies(pair)
        assert await agui_job.resume_waiting_runs() == 0

    async def test_a_chain_comes_back_only_so_many_times(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(agui_later, "MAX_PER_CHAIN", 1)
        await ask_helper(
            pair,
            "@Helper keep an eye on the deploy",
            agui=[
                follow_up(later(hours=1), "look again"),
                calls(("c2", "schedule_followup", {"when": later(hours=2), "note": "again"})),
                says("Still open: the deploy."),
            ],
        )
        [waiting] = await helper_runs()
        await bring_forward(waiting.id)
        await wake(pair)

        assert "has already come back 1 times" in tool_results(pair)[-1]
        assert [run.status for run in await helper_runs()] == ["succeeded", "succeeded"]


class TestWhatItMayAskFor:
    @pytest.mark.parametrize(
        ("case", "said"),
        [
            ("soon", "at least a minute from now"),
            ("far", "within 14 days"),
            ("no_offset", "with its offset"),
            ("no_note", "Say what you will do"),
            ("long_note", f"keep it to {500}"),
        ],
    )
    async def test_a_call_it_may_not_make_is_a_result_it_reads(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
        case: str,
        said: str,
    ) -> None:
        arguments = {
            "soon": {"when": later(seconds=20), "note": "soon"},
            "far": {"when": later(days=15), "note": "far"},
            "no_offset": {"when": "2026-12-24T10:00:00", "note": "noon where?"},
            "no_note": {"when": later(hours=1)},
            "long_note": {"when": later(hours=1), "note": "x" * 501},
        }[case]
        await ask_helper(
            pair,
            "@Helper come back to this",
            agui=[calls(("c1", "schedule_followup", arguments)), says("Then I will not.")],
        )
        assert said in tool_results(pair)[-1]
        assert [run.status for run in await helper_runs()] == ["succeeded"]

    async def test_it_is_offered_to_an_agent_asked_and_never_to_one_following(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        await ask_helper(pair, "@Helper hello", agui=[says("Hello.")])
        request = pair["state"]["seen"]["/agui"][0]
        offered = [tool["name"] for tool in json.loads(request.content)["tools"]]
        assert "schedule_followup" in offered
        assert "schedule_followup" in agui_tools.offered_names("write")
        # What a run nobody addressed is cut down to (ADR 0026): it may look, not wait.
        assert "schedule_followup" not in agui_tools.READ_TOOLS


class TestAskedAgainOnWaking:
    @pytest.mark.parametrize(
        ("change", "said"),
        [
            ("deactivated", "Marko's account was deactivated"),
            ("left", "Marko is no longer in this conversation"),
            ("archived", "the conversation was archived"),
            ("agents_off", "agents are turned off for this server"),
        ],
    )
    async def test_a_follow_up_the_person_no_longer_may_have_ends_with_why(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
        change: str,
        said: str,
    ) -> None:
        pair["state"]["scripts"] = {"/agui": [follow_up(later(days=2)), says("Never said.")]}
        sent = await send_message(pair["marko"], pair["general"], "@Helper watch the deploy")
        assert sent.status == 201, sent.body
        await settle(pair)
        [waiting] = await helper_runs()
        marko = str(waiting.initiated_by_user_id)

        if change == "deactivated":
            await execute("UPDATE users SET deactivated_at = now() WHERE id = :u", u=marko)
        elif change == "left":
            await execute(
                "DELETE FROM channel_members WHERE channel_id = :c AND user_id = :u",
                c=pair["general"],
                u=marko,
            )
        elif change == "archived":
            await execute(
                "UPDATE channels SET archived_at = now() WHERE id = :c", c=pair["general"]
            )
        else:
            await execute(
                """
                INSERT INTO workspace_settings (workspace_id, settings)
                VALUES (:ws, '{"agentsEnabled": false}')
                ON CONFLICT (workspace_id) DO UPDATE
                   SET settings = workspace_settings.settings || '{"agentsEnabled": false}'
                """,
                ws=pair["workspace_id"],
            )
        await bring_forward(waiting.id)
        await wake(pair)

        ended = await run_row(waiting.id)
        assert ended.status == "failed"
        assert ended.error == f"it did not come back: {said}"
        assert asked_times(pair) == 1, "the agent was not called"
        assert ("Helper", "Never said.") not in await bodies(pair)

    async def test_a_wait_whose_message_is_gone_ends_rather_than_waits_for_ever(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        await ask_helper(pair, "@Helper look again tomorrow", agui=[follow_up(later(days=1))])
        [waiting] = await helper_runs()
        await execute(
            "UPDATE agent_runs SET trigger_message_id = NULL WHERE id = :id", id=waiting.id
        )
        await bring_forward(waiting.id)
        await wake(pair)

        ended = await run_row(waiting.id)
        assert ended.status == "failed" and "is gone" in ended.error
        assert await agui_job.resume_waiting_runs() == 0, "not picked up again every minute"


class TestLikeAnyWaitingRun:
    async def test_stop_ends_it(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        await ask_helper(pair, "@Helper look again tomorrow", agui=[follow_up(later(days=1))])
        [waiting] = await helper_runs()
        stopped = await pair["owner"].post(f"/api/agent-runs/{waiting.id}/cancel")
        assert stopped.status == 200, stopped.body
        await bring_forward(waiting.id)

        assert await agui_job.resume_waiting_runs() == 0
        assert (await run_row(waiting.id)).status == "cancelled"
        assert asked_times(pair) == 1

    @pytest.mark.parametrize(
        "call",
        [
            ("c1", "schedule_followup", {"when": "", "note": "look again"}),
            ("c1", "post_message", {"channel": "#general", "text": "The deploy is out."}),
        ],
        ids=["follow_up", "approval"],
    )
    async def test_stop_pressed_while_its_calls_run_is_not_lost(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
        monkeypatch: pytest.MonkeyPatch,
        call: tuple[str, str, dict[str, Any]],
    ) -> None:
        """Stop is heard only while the agent streams. Pressed while Blob runs the round's
        calls — an outside tool may take a while — and that round ending in a wait or an
        approval, the run used to go `waiting` or `interrupted` and carry on later as if
        nobody had pressed it."""
        call_id, name, arguments = call
        if name == "schedule_followup":
            arguments = {**arguments, "when": later(days=1)}
        else:
            allowed = await pair["owner"].post(
                f"/api/admin/plugins/{pair['helper']['plugin']['id']}/tools", {"access": "write"}
            )
            assert allowed.status == 200, allowed.body
        run_calls = agui_outcome._run_calls

        async def stopped_meanwhile(*args: Any, **kwargs: Any) -> Any:
            [running] = await helper_runs()
            stopped = await pair["owner"].post(f"/api/agent-runs/{running.id}/cancel")
            assert stopped.status == 200, stopped.body
            return await run_calls(*args, **kwargs)

        monkeypatch.setattr(agui_outcome, "_run_calls", stopped_meanwhile)
        await ask_helper(pair, "@Helper watch the deploy", agui=[calls((call_id, name, arguments))])

        [run] = await helper_runs()
        assert (await run_row(run.id)).status == "cancelled"
        if name == "schedule_followup":
            await bring_forward(run.id)
            assert await agui_job.resume_waiting_runs() == 0
        assert asked_times(pair) == 1

    async def test_the_nightly_sweep_leaves_a_waiting_run_alone(
        self,
        pair: dict[str, Any],  # noqa: F811 — the fixture imported above
    ) -> None:
        await ask_helper(pair, "@Helper look again next week", agui=[follow_up(later(days=13))])
        [waiting] = await helper_runs()
        await execute("UPDATE agent_runs SET started_at = now() - interval '40 days'")

        async with transaction() as (session, _after):
            removed = await agent_run_service.sweep(session)

        assert removed == 0
        assert (await run_row(waiting.id)).status == "waiting"
