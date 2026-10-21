"""Jobs cross Redis as JSON, never pickle (the 2026-10 security review).

Unpickling runs whatever the bytes say, so with arq's default anything able to write to
Redis could run code in the worker. A job here is ids and nothing else.
"""

from __future__ import annotations

import json
import pickle
from typing import Any

import pytest

from blob_api.jobs.worker import WorkerSettings
from blob_api.lib import queue as queue_lib
from blob_api.lib.redis import redis

RAN: list[str] = []


class Payload:
    """What a hostile pickle looks like: unpickling it calls something."""

    def __reduce__(self) -> Any:
        return (RAN.append, ("the pickle ran",))


def test_a_job_goes_through_json_and_comes_back_the_same() -> None:
    job = {"t": 1, "f": "agui_run", "a": ["01a1-msg", None], "k": {}, "et": 1730000000000}
    assert queue_lib.deserialize_job(queue_lib.serialize_job(job)) == job


def test_a_pickle_is_refused_unread() -> None:
    hostile = pickle.dumps({"f": "notify", "a": [Payload()]})
    with pytest.raises(ValueError):
        queue_lib.deserialize_job(hostile)
    assert RAN == []


def test_the_worker_reads_jobs_the_same_way() -> None:
    assert WorkerSettings.job_serializer is queue_lib.serialize_job
    assert WorkerSettings.job_deserializer is queue_lib.deserialize_job


async def test_what_lands_in_redis_is_json() -> None:
    pool = await queue_lib.get_pool()
    job = await pool.enqueue_job("notify", "01a15dd7-0000-7000-8000-000000000001")
    assert job is not None
    raw = await redis.get(f"arq:job:{job.job_id}")
    stored = json.loads(raw)
    assert stored["f"] == "notify"
    assert stored["a"] == ["01a15dd7-0000-7000-8000-000000000001"]
