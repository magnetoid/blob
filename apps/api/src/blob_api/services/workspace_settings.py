"""Typed readers over the workspace_settings JSONB blob.

The table is one JSON document per workspace, merged on write. Callers used to poke
string keys (`signupPolicy`, `retentionDays`) with no default and no type, so a typo
or a missing row meant "whatever the if-not-None branch did". These readers are the
contract: unknown keys are ignored, missing keys are defaults, bad values fall back.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import text

from ..db.engine import session_scope

SignupPolicy = Literal["invite", "open"]

DEFAULT_RETENTION_DAYS = 365
DEFAULT_UPLOAD_LIMIT = 100 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class TypedSettings:
    signup_policy: SignupPolicy = "invite"
    retention_days: int = DEFAULT_RETENTION_DAYS
    upload_limit_bytes: int = DEFAULT_UPLOAD_LIMIT
    agents_enabled: bool = True
    banner: str | None = None


def parse(raw: dict[str, Any] | None) -> TypedSettings:
    data = raw or {}
    policy = data.get("signupPolicy", "invite")
    signup_policy: SignupPolicy = policy if policy in ("invite", "open") else "invite"

    try:
        retention = int(data.get("retentionDays", DEFAULT_RETENTION_DAYS))
    except (TypeError, ValueError):
        retention = DEFAULT_RETENTION_DAYS
    retention = max(30, min(retention, 3650))

    try:
        upload = int(data.get("uploadLimitBytes", DEFAULT_UPLOAD_LIMIT))
    except (TypeError, ValueError):
        upload = DEFAULT_UPLOAD_LIMIT
    upload = max(1024, min(upload, 1024 * 1024 * 1024))

    agents = data.get("agentsEnabled", True)
    banner_raw = data.get("banner")
    banner = banner_raw.strip() if isinstance(banner_raw, str) and banner_raw.strip() else None
    return TypedSettings(
        signup_policy=signup_policy,
        retention_days=retention,
        upload_limit_bytes=upload,
        agents_enabled=bool(agents) if not isinstance(agents, str) else agents.lower() != "false",
        banner=banner,
    )


async def load(workspace_id: str) -> TypedSettings:
    async with session_scope() as session:
        row = (
            await session.execute(
                text("SELECT settings FROM workspace_settings WHERE workspace_id = :ws"),
                {"ws": workspace_id},
            )
        ).fetchone()
    return parse(row.settings if row else None)


async def load_retention_days() -> int:
    """The tightest retention across workspaces, for the instance-wide audit sweep.

    A missing row is the default. Several workspaces keep the shortest number so one
    tenant asking for 90 days does not keep everyone else's audit for a year.
    """
    async with session_scope() as session:
        rows = (await session.execute(text("SELECT settings FROM workspace_settings"))).fetchall()
    if not rows:
        return DEFAULT_RETENTION_DAYS
    return min(parse(row.settings).retention_days for row in rows)
