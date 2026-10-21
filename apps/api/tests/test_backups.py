"""Nightly database backups (M3 · B4).

`pg_dump` run by the worker, streamed into object storage, kept for `BACKUP_KEEP_DAYS`, and
reported on the Health page. A fake `pg_dump` script stands in for the real one, except in
the last test, which runs the real client against the test database where it is new
enough to.
"""

from __future__ import annotations

import asyncio
import re
import shutil
import subprocess
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from blob_api.config import settings
from blob_api.jobs import backup as backup_job
from blob_api.lib import storage

from .helpers import Client, invite_and_sign_up, sign_up

NOW = datetime(2026, 10, 21, 3, 30, tzinfo=UTC)


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Object storage as a dict: what was uploaded, under which key, and when."""
    state: dict[str, Any] = {"objects": {}, "removed": []}

    def upload(key: str, stream: Any, *, bucket: str) -> None:
        state["bucket"] = bucket
        state["objects"][key] = {"body": stream.read(), "at": NOW}

    def listing(prefix: str, *, bucket: str) -> list[dict[str, Any]]:
        return [
            {"Key": key, "Size": len(item["body"]), "LastModified": item["at"]}
            for key, item in state["objects"].items()
            if key.startswith(prefix)
        ]

    def remove(key: str, *, bucket: str) -> None:
        state["removed"].append(key)
        state["objects"].pop(key, None)

    monkeypatch.setattr(storage, "upload_stream", upload)
    monkeypatch.setattr(storage, "list_objects", listing)
    monkeypatch.setattr(storage, "remove_object", remove)
    return state


def fake_pg_dump(tmp_path: Path, *, exit_code: int = 0, stderr: str = "") -> Path:
    """A `pg_dump` that writes a few bytes, and notes what it was given."""
    seen = tmp_path / "seen.txt"
    script = tmp_path / "pg_dump"
    script.write_text(
        "#!/bin/sh\n"
        f'echo "args: $*" > {seen}\n'
        f'echo "password: ${{PGPASSWORD:+set}}" >> {seen}\n'
        "printf 'PGDMP-fake-dump'\n"
        f"printf '{stderr}' >&2\n"
        f"exit {exit_code}\n"
    )
    script.chmod(0o755)
    return script


async def test_a_backup_streams_into_the_bucket_and_says_how_it_went(
    tmp_path: Path, bucket: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "BACKUP_PG_DUMP", str(fake_pg_dump(tmp_path)))
    outcome = await backup_job.run_backup(now=NOW)

    assert outcome is not None and outcome.ok
    assert outcome.key == "backups/blob-20261021T033000Z.dump"
    assert outcome.bytes == len(b"PGDMP-fake-dump")
    assert bucket["objects"][outcome.key]["body"] == b"PGDMP-fake-dump"
    assert bucket["bucket"] == settings.S3_BUCKET, "no backup bucket: the uploads' own"
    assert (await backup_job.last_outcome()) == outcome


async def test_the_password_goes_in_the_environment_never_the_arguments(
    tmp_path: Path, bucket: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "BACKUP_PG_DUMP", str(fake_pg_dump(tmp_path)))
    await backup_job.run_backup(now=NOW)
    seen = (tmp_path / "seen.txt").read_text()
    assert "--format=custom" in seen and "password: set" in seen
    password = re.search(r"://[^:]+:([^@]+)@", settings.DATABASE_URL)
    assert password is not None and password.group(1) not in seen


async def test_a_failed_dump_leaves_nothing_behind_and_says_why(
    tmp_path: Path, bucket: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    dump = fake_pg_dump(tmp_path, exit_code=1, stderr="pg_dump: error: connection refused")
    monkeypatch.setattr(settings, "BACKUP_PG_DUMP", str(dump))
    outcome = await backup_job.run_backup(now=NOW)

    assert outcome is not None and not outcome.ok
    assert outcome.error == "pg_dump: error: connection refused"
    assert bucket["objects"] == {} and bucket["removed"] == ["backups/blob-20261021T033000Z.dump"]


async def test_no_pg_dump_is_said_out_loud(
    bucket: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "BACKUP_PG_DUMP", "pg_dump-that-is-not-here")
    outcome = await backup_job.run_backup(now=NOW)
    assert outcome is not None and not outcome.ok
    assert "not installed" in (outcome.error or "")


async def test_old_backups_go_and_the_newest_never_does(
    tmp_path: Path, bucket: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    for days in (40, 20, 3):
        at = NOW - timedelta(days=days)
        bucket["objects"][f"backups/blob-{at:%Y%m%d}.dump"] = {"body": b"x", "at": at}
    monkeypatch.setattr(settings, "BACKUP_PG_DUMP", str(fake_pg_dump(tmp_path)))
    await backup_job.run_backup(now=NOW)
    assert sorted(bucket["objects"]) == [
        "backups/blob-20261018.dump",
        "backups/blob-20261021T033000Z.dump",
    ]

    # With every backup old, the newest still stays.
    bucket["objects"].clear()
    bucket["objects"]["backups/old.dump"] = {"body": b"x", "at": NOW - timedelta(days=90)}
    monkeypatch.setattr(
        storage, "upload_stream", lambda *a, **k: (_ for _ in ()).throw(OSError("down"))
    )
    failed = await backup_job.run_backup(now=NOW)
    assert failed is not None and not failed.ok
    assert "backups/old.dump" in bucket["objects"]


async def test_switched_off_does_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "BACKUP_ENABLED", False)
    assert await backup_job.run_backup(now=NOW) is None


async def test_the_health_page_shows_the_last_one(
    client: Client, tmp_path: Path, bucket: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Olga Owner")
    before = (await owner.get("/api/admin/health")).body["backup"]
    assert before == {"enabled": True, "at": None, "ok": None, "bytes": None, "error": None}
    monkeypatch.setattr(settings, "BACKUP_PG_DUMP", str(fake_pg_dump(tmp_path)))
    await backup_job.run_backup(now=NOW)
    after = (await owner.get("/api/admin/health")).body["backup"]
    assert after["ok"] is True and after["bytes"] == len(b"PGDMP-fake-dump")


async def test_only_the_server_s_administrators_back_up_now(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await sign_up(client, "Olga Owner")
    admin = await invite_and_sign_up(owner, "Adam Admin", role="admin")
    queued: list[str] = []

    async def enqueue(job: str, *args: Any) -> None:
        queued.append(job)

    monkeypatch.setattr("blob_api.routers.admin_instance.enqueue", enqueue)
    assert (await admin.post("/api/admin/instance/backup", {})).status == 403
    assert (await owner.post("/api/admin/instance/backup", {})).status == 200
    assert queued == ["backup"]


def _major(version_line: str) -> int:
    match = re.search(r"(\d+)\.", version_line)
    return int(match.group(1)) if match else 0


async def test_the_real_pg_dump_writes_a_custom_format_dump(bucket: dict[str, Any]) -> None:
    """Against the test database, where this machine's client is new enough to dump it."""
    binary = shutil.which("pg_dump")
    if binary is None:
        pytest.skip("no pg_dump here")
    version = await asyncio.to_thread(
        subprocess.run, [binary, "--version"], capture_output=True, text=True
    )
    client = _major(version.stdout)
    from sqlalchemy import text

    from blob_api.db.engine import SessionFactory

    async with SessionFactory() as session:
        server = _major(str((await session.execute(text("SHOW server_version"))).scalar_one()))
    if client < server:
        pytest.skip(f"pg_dump {client} cannot dump a {server} server")
    outcome = await backup_job.run_backup(now=NOW)
    assert outcome is not None and outcome.ok, outcome
    body = bucket["objects"][outcome.key]["body"]
    assert body.startswith(b"PGDMP"), "the custom format's magic"
    assert outcome.bytes == len(body) > 1000
