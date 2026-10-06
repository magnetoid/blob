"""The worker's limits, so a hung job cannot sit on a slot until the process dies."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from blob_api.config import settings
from blob_api.jobs.worker import WorkerSettings, after_job_end
from blob_api.plugins import gateway


def _agent_run_function() -> Any:
    found = [f for f in WorkerSettings.functions if getattr(f, "name", None) == "agui_run"]
    assert len(found) == 1, "agui_run is registered with its own limits, through arq.func"
    return found[0]


def test_an_agent_run_outlasts_its_own_wall_and_is_never_retried() -> None:
    # The worker-wide 300 used to apply here while AGUI_MAX_RUN_SEC promised 600, so
    # arq cancelled every run past five minutes with its answer unposted. The run's
    # own clocks are the policy; arq's ceiling only has to sit above them.
    run = _agent_run_function()
    assert run.timeout_s is not None and run.timeout_s > settings.AGUI_MAX_RUN_SEC
    # One try: a retry of a cancelled run asks the agent again and posts a second answer.
    assert run.max_tries == 1


def test_a_socket_runs_claim_outlives_the_run(monkeypatch: pytest.MonkeyPatch) -> None:
    # The claim is also the ownership check on every event the agent sends back. It
    # expired at 300s and was never refreshed, so a socket run past five minutes had
    # every later event dropped in silence.
    assert gateway.claim_ttl_sec() > settings.AGUI_MAX_RUN_SEC
    monkeypatch.setattr(settings, "AGUI_MAX_RUN_SEC", 1800.0)
    assert gateway.claim_ttl_sec() > 1800.0


def test_the_worker_does_not_wait_forever_or_retry_forever() -> None:
    # arq's defaults are 300s / 5 tries / 10 jobs. max_jobs was already 8; the timeout
    # and the retry cap were whatever the library shipped, which is how a wedged job
    # (or a poison payload) occupied a slot for the rest of the morning.
    assert WorkerSettings.job_timeout == 300
    assert WorkerSettings.max_tries == 3
    assert WorkerSettings.max_jobs == 8
    assert WorkerSettings.__dict__["after_job_end"] is after_job_end


@pytest.mark.asyncio
async def test_a_failed_job_is_logged_once_the_result_is_stored(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class FakeJob:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        async def result_info(self) -> SimpleNamespace:
            return SimpleNamespace(success=False, function="notify", result=RuntimeError("boom"))

    monkeypatch.setattr("arq.jobs.Job", FakeJob)
    with caplog.at_level("ERROR", logger="blob.worker"):
        await after_job_end({"job_id": "j1", "job_try": 3, "redis": object()})

    assert any("job notify failed" in record.message for record in caplog.records)


@pytest.mark.asyncio
async def test_a_successful_job_stays_quiet(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    class FakeJob:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        async def result_info(self) -> SimpleNamespace:
            return SimpleNamespace(success=True, function="notify", result=None)

    monkeypatch.setattr("arq.jobs.Job", FakeJob)
    with caplog.at_level("ERROR", logger="blob.worker"):
        await after_job_end({"job_id": "j1", "job_try": 1, "redis": object()})

    assert caplog.records == []


@pytest.mark.asyncio
async def test_missing_result_is_not_an_error() -> None:
    await after_job_end({})
    await after_job_end({"job_id": "j1"})
