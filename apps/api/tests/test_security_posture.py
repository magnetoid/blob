"""The console's Security page (M3 · C3): the workspace's checks for every admin, the
server's for whoever administers it — each read live."""

from __future__ import annotations

from typing import Any

import pytest

from blob_api.config import settings

from .helpers import Client, invite_and_sign_up, sign_up


def by_id(checks: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {check["id"]: check for check in checks}


async def test_admins_see_the_workspace_and_the_server_s_admins_the_server(
    client: Client,
) -> None:
    founder = await sign_up(client, "Olga Owner")  # the first sign-up runs the server
    admin = await invite_and_sign_up(founder, "Adam Admin", role="admin")
    member = await invite_and_sign_up(founder, "Max Member")

    assert (await member.get("/api/admin/security")).status == 403
    plain = (await admin.get("/api/admin/security")).body
    assert plain["server"] is None
    assert {"admins_two_step", "agents_ask", "history", "audit"} <= set(by_id(plain["workspace"]))

    full = (await founder.get("/api/admin/security")).body
    server = by_id(full["server"])
    # The test server runs in development mode with no Redis password.
    assert server["cookie"]["state"] == "attention"
    assert server["redis_password"]["state"] == "attention"


async def test_the_checks_follow_what_is_true_now(
    client: Client, monkeypatch: pytest.MonkeyPatch
) -> None:
    founder = await sign_up(client, "Olga Owner")
    checks = by_id((await founder.get("/api/admin/security")).body["workspace"])
    assert checks["admins_two_step"]["state"] == "attention"
    assert checks["admins_two_step"]["detail"].startswith("0 of 1 admin")
    assert checks["agents_ask"]["state"] == "ok"
    assert checks["history"]["detail"] == "Keeps everything, for good."

    saved = await founder.put("/api/admin/retention", {"messageDays": 90, "fileDays": None})
    assert saved.status == 200, saved.body
    monkeypatch.setattr(settings, "NODE_ENV", "production")
    monkeypatch.setattr(settings, "REDIS_URL", "redis://:a-password@redis:6379/0")

    after = (await founder.get("/api/admin/security")).body
    assert by_id(after["workspace"])["history"]["detail"].startswith("Keeps messages for 90 days")
    server = by_id(after["server"])
    assert server["cookie"]["state"] == "ok"
    assert server["redis_password"]["state"] == "ok"
