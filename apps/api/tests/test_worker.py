"""The worker's limits, so a hung job cannot sit on a slot until the process dies."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from blob_api.jobs.worker import WorkerSettings, after_job_end


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
