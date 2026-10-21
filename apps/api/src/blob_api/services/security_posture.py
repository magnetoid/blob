"""How this workspace, and this server, stand on security — read live, never stored
(M3 · C3). The admin console's Security page.

A check is a fact and what it means: `ok`, `attention` when it is worth an admin's look,
`info` when it is a choice either way. Every admin sees the workspace's checks; the
server's own — how it was deployed — only its administrators, as with its logs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from . import retention as retention_service
from . import workspace_settings as settings_service

State = Literal["ok", "attention", "info"]


@dataclass(frozen=True, slots=True)
class Check:
    id: str
    title: str
    state: State
    detail: str


def _plural(n: int, one: str, many: str) -> str:
    return f"{n} {one if n == 1 else many}"


async def _scalar(session: AsyncSession, sql: str, **params: Any) -> Any:
    return (await session.execute(text(sql), params)).scalar()


async def workspace_checks(session: AsyncSession, workspace_id: str) -> list[Check]:
    checks: list[Check] = []

    admins = (
        await session.execute(
            text(
                """
                SELECT count(*) AS total,
                       count(*) FILTER (WHERE EXISTS (
                         SELECT 1 FROM passkey_owners o
                          WHERE o.email = u.email AND o.two_step
                            AND EXISTS (SELECT 1 FROM passkeys p WHERE p.email = o.email)
                       )) AS two_step
                  FROM users u
                 WHERE u.workspace_id = :ws AND u.role IN ('admin', 'owner')
                   AND u.deactivated_at IS NULL AND u.kind = 'human'
                """
            ),
            {"ws": workspace_id},
        )
    ).one()
    total, two_step = int(admins.total), int(admins.two_step)
    checks.append(
        Check(
            "admins_two_step",
            "Admins sign in with a passkey as well",
            "ok" if total and two_step == total else "attention",
            f"{two_step} of {_plural(total, 'admin', 'admins')} ask for a passkey after the "
            "password. Each turns it on in their own settings.",
        )
    )

    providers = int(await _scalar(session, "SELECT count(*) FROM sso_providers WHERE enabled"))
    checks.append(
        Check(
            "sso",
            "Single sign-on",
            "info",
            f"{_plural(providers, 'identity provider', 'identity providers')} signing people in."
            if providers
            else "Off: people sign in with a password or a passkey.",
        )
    )

    trusting = int(
        await _scalar(
            session,
            """
            SELECT count(*) FROM plugins
             WHERE workspace_id = :ws AND status = 'enabled' AND write_approval <> 'ask'
            """,
            ws=workspace_id,
        )
    )
    checks.append(
        Check(
            "agents_ask",
            "Agents ask before they post",
            "ok" if trusting == 0 else "attention",
            "Every agent's post waits for the person who asked."
            if trusting == 0
            else f"{_plural(trusting, 'agent posts', 'agents post')} without asking somewhere — "
            "its page under Apps & agents says where.",
        )
    )

    writers = int(
        await _scalar(
            session,
            """
            SELECT count(*) FROM plugins
             WHERE workspace_id = :ws AND status = 'enabled' AND tool_access = 'write'
            """,
            ws=workspace_id,
        )
    )
    checks.append(
        Check(
            "agents_write",
            "Agents that can act with Blob's tools",
            "info",
            f"{_plural(writers, 'agent', 'agents')} may write — always as the person who asked, "
            "inside the room it was asked in."
            if writers
            else "None: agents read at most.",
        )
    )

    assistants = int(
        await _scalar(
            session,
            """
            SELECT count(DISTINCT user_id) FROM mcp_tokens
             WHERE workspace_id = :ws AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > now())
            """,
            ws=workspace_id,
        )
    )
    checks.append(
        Check(
            "assistants",
            "Assistants signed in as people",
            "info",
            f"{_plural(assistants, 'person has', 'people have')} an assistant connected, with "
            "exactly their own reach."
            if assistants
            else "None connected.",
        )
    )

    typed = await settings_service.load_in(session, workspace_id)
    policy = retention_service.from_settings(typed)
    holds = int(
        await _scalar(
            session,
            """
            SELECT (SELECT count(*) FROM channels
                     WHERE workspace_id = :ws AND legal_hold_at IS NOT NULL)
                 + (SELECT count(*) FROM users
                     WHERE workspace_id = :ws AND legal_hold_at IS NOT NULL)
            """,
            ws=workspace_id,
        )
    )
    windows = [
        f"messages for {policy.message_days} days" if policy.message_days else None,
        f"files for {policy.file_days} days" if policy.file_days else None,
    ]
    kept = " and ".join(part for part in windows if part) or "everything, for good"
    checks.append(
        Check(
            "history",
            "How long history is kept",
            "info",
            f"Keeps {kept}"
            + (f"; {_plural(holds, 'legal hold', 'legal holds')} in place." if holds else "."),
        )
    )
    checks.append(
        Check(
            "audit",
            "Audit log",
            "info",
            f"Kept for {typed.retention_days} days.",
        )
    )
    return checks


def server_checks() -> list[Check]:
    """How the server was deployed — for its administrators."""
    checks: list[Check] = []
    checks.append(
        Check(
            "cookie",
            "Sessions are bound to this host",
            "ok" if settings.is_prod else "attention",
            "The session cookie is __Host-, Secure and HTTP-only."
            if settings.is_prod
            else "Development mode: a plain cookie, sent over plain HTTP.",
        )
    )
    redis_password = bool(urlsplit(settings.REDIS_URL).password)
    checks.append(
        Check(
            "redis_password",
            "Redis asks for a password",
            "ok" if redis_password else "attention",
            "REDIS_URL carries a password."
            if redis_password
            else "No password in REDIS_URL: anything that can reach Redis can read who is "
            "online and put jobs in the queue.",
        )
    )
    checks.append(
        Check(
            "private_endpoints",
            "Agents on this server's own network",
            "attention" if settings.AGENT_ALLOW_PRIVATE_ENDPOINTS else "ok",
            "Allowed: an agent may be registered at a private address — the database's "
            "network included — where a workspace's policy lets it."
            if settings.AGENT_ALLOW_PRIVATE_ENDPOINTS
            else "Refused: agents are reached at public addresses only.",
        )
    )
    checks.append(
        Check(
            "terminal",
            "A terminal into hosted agents",
            "info",
            "On: an administrator can open a shell inside an agent this server hosts."
            if settings.AGENT_SHELL_HOST
            else "Off.",
        )
    )
    checks.append(
        Check(
            "telemetry",
            "What leaves the server for monitoring",
            "info",
            ", ".join(
                part
                for part in (
                    "traces to an OTLP collector" if settings.OTEL_EXPORTER_OTLP_ENDPOINT else "",
                    "/metrics behind its token" if settings.METRICS_TOKEN else "",
                )
                if part
            )
            or "Nothing: no traces, and /metrics is off.",
        )
    )
    return checks


__all__ = ["Check", "server_checks", "workspace_checks"]
