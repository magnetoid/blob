"""The per-worker naming that lets the suite run in parallel."""

from __future__ import annotations

import pytest

from .workers import per_worker_database, per_worker_redis, worker_environment, worker_index


def test_a_worker_gets_a_database_of_its_own() -> None:
    assert (
        per_worker_database("postgres://blob:blob@localhost:5432/blob_test", "gw2")
        == "postgres://blob:blob@localhost:5432/blob_test_gw2"
    )


def test_a_query_string_survives_the_rename() -> None:
    assert (
        per_worker_database("postgres://h/blob_test?sslmode=disable", "gw0")
        == "postgres://h/blob_test_gw0?sslmode=disable"
    )


def test_workers_count_down_from_the_configured_redis_db() -> None:
    assert per_worker_redis("redis://localhost:6379/15", "gw0") == "redis://localhost:6379/15"
    assert per_worker_redis("redis://localhost:6379/15", "gw3") == "redis://localhost:6379/12"


def test_running_out_of_redis_dbs_is_an_error_not_a_collision() -> None:
    with pytest.raises(ValueError):
        per_worker_redis("redis://localhost:6379/1", "gw2")


def test_only_xdist_worker_ids_are_accepted() -> None:
    assert worker_index("gw11") == 11
    with pytest.raises(ValueError):
        worker_index("main")


def test_no_worker_means_no_overrides() -> None:
    base = {"DATABASE_URL": "postgres://h/blob_test", "REDIS_URL": "redis://h/15"}
    assert worker_environment(base) == {}


def test_a_worker_gets_both_overrides() -> None:
    base = {
        "PYTEST_XDIST_WORKER": "gw1",
        "DATABASE_URL": "postgres://h/blob_test",
        "REDIS_URL": "redis://h/15",
    }
    assert worker_environment(base) == {
        "DATABASE_URL": "postgres://h/blob_test_gw1",
        "REDIS_URL": "redis://h/14",
    }
