"""What a workspace is allowed to do to the machine it runs on.

Every app endpoint authorises a *workspace* admin, which was the whole story while one
workspace was the server. Multi-workspace split the workspace admin from the person who
owns the hardware, and left every capability with the former: registering an app, running
a repository's code as a container on the operator's box, holding a socket into this
process. This is where the operator gets a say.

**The environment is the ceiling and policy is the floor.** `AGENT_RUNNER` and
`AGENT_ALLOW_PRIVATE_ENDPOINTS` decide what the server can do at all; a policy row
narrows that for one workspace and can never widen it. `effective_for` is the only place
the two are combined, so there is one answer to "may this workspace do X" rather than a
settings check here and a policy check there that disagree the first time somebody edits
one of them.

A missing row means the column defaults, which are closed for the two capabilities that
reach the host. That is deliberate and it is why migration 0013 seeds the workspaces that
already existed as permissive: a new workspace on somebody's server should start unable
to deploy containers onto it, and a workspace that could do so yesterday should not
silently lose the ability at upgrade.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib.errors import AppError

#: Every field an instance admin can set, so the router and the tests agree on the list.
POLICY_FIELDS = (
    "may_host_agents",
    "may_use_private_endpoints",
    "may_connect_socket_agents",
    "denied_scopes",
    "max_apps",
)


@dataclass(slots=True)
class Policy:
    """What this workspace may actually do, environment included."""

    may_host_agents: bool = False
    may_use_private_endpoints: bool = False
    may_connect_socket_agents: bool = True
    denied_scopes: frozenset[str] = field(default_factory=frozenset)
    max_apps: int | None = None


def _row_to_policy(row: Any) -> Policy:
    return Policy(
        may_host_agents=row.may_host_agents,
        may_use_private_endpoints=row.may_use_private_endpoints,
        may_connect_socket_agents=row.may_connect_socket_agents,
        denied_scopes=frozenset(row.denied_scopes or []),
        max_apps=row.max_apps,
    )


async def stored_for(session: AsyncSession, workspace_id: str) -> Policy:
    """What is written down, before the environment has its say.

    This is what the console edits and shows. `effective_for` is what the guards ask,
    and the two differ whenever the operator has turned a capability off server-wide —
    which the console says out loud rather than showing a tick that does nothing.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT may_host_agents, may_use_private_endpoints,
                       may_connect_socket_agents, denied_scopes, max_apps
                  FROM workspace_policies WHERE workspace_id = :ws
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchone()
    # No row is the documented default rather than an error: a workspace created before
    # policies existed, or one nobody has configured, is simply on the defaults.
    return Policy() if row is None else _row_to_policy(row)


async def effective_for(session: AsyncSession, workspace_id: str) -> Policy:
    """Policy narrowed by what the server permits at all. What every guard asks."""
    stored = await stored_for(session, workspace_id)
    return Policy(
        # `AGENT_RUNNER` unset means no runner exists to deploy through, so no policy row
        # can make hosting possible. Ceiling, not preference.
        may_host_agents=stored.may_host_agents and settings.AGENT_RUNNER != "disabled",
        may_use_private_endpoints=(
            stored.may_use_private_endpoints and settings.AGENT_ALLOW_PRIVATE_ENDPOINTS
        ),
        may_connect_socket_agents=stored.may_connect_socket_agents,
        denied_scopes=stored.denied_scopes,
        max_apps=stored.max_apps,
    )


async def write(
    session: AsyncSession,
    *,
    workspace_id: str,
    actor_id: str | None,
    **fields: Any,
) -> Policy:
    """Set a workspace's policy. Upsert, because a workspace may have no row yet."""
    unknown = sorted(set(fields) - set(POLICY_FIELDS))
    if unknown:
        raise AppError(400, "invalid_input", f"Unknown policy field: {', '.join(unknown)}.")

    current = await stored_for(session, workspace_id)
    merged = {
        "may_host_agents": fields.get("may_host_agents", current.may_host_agents),
        "may_use_private_endpoints": fields.get(
            "may_use_private_endpoints", current.may_use_private_endpoints
        ),
        "may_connect_socket_agents": fields.get(
            "may_connect_socket_agents", current.may_connect_socket_agents
        ),
        "denied_scopes": list(fields.get("denied_scopes", sorted(current.denied_scopes))),
        "max_apps": fields.get("max_apps", current.max_apps),
    }

    await session.execute(
        text(
            """
            INSERT INTO workspace_policies
                (workspace_id, may_host_agents, may_use_private_endpoints,
                 may_connect_socket_agents, denied_scopes, max_apps, updated_by)
            VALUES (:ws, :host, :private, :socket, cast(:denied AS text[]), :max_apps, :actor)
            ON CONFLICT (workspace_id) DO UPDATE SET
                may_host_agents = EXCLUDED.may_host_agents,
                may_use_private_endpoints = EXCLUDED.may_use_private_endpoints,
                may_connect_socket_agents = EXCLUDED.may_connect_socket_agents,
                denied_scopes = EXCLUDED.denied_scopes,
                max_apps = EXCLUDED.max_apps,
                updated_at = now(),
                updated_by = EXCLUDED.updated_by
            """
        ),
        {
            "ws": workspace_id,
            "host": merged["may_host_agents"],
            "private": merged["may_use_private_endpoints"],
            "socket": merged["may_connect_socket_agents"],
            "denied": merged["denied_scopes"],
            "max_apps": merged["max_apps"],
            "actor": actor_id,
        },
    )
    return await stored_for(session, workspace_id)


async def app_count(session: AsyncSession, workspace_id: str) -> int:
    row = (
        await session.execute(
            text("SELECT count(*) AS n FROM plugins WHERE workspace_id = :ws"),
            {"ws": workspace_id},
        )
    ).fetchone()
    return int(row.n if row else 0)


# ─── the refusals, worded once ────────────────────────────────────────────────


def refuse_hosting() -> AppError:
    return AppError(
        403,
        "policy_forbidden",
        "This workspace is not allowed to deploy hosted agents. Ask a server administrator.",
    )


def refuse_private_endpoint() -> AppError:
    return AppError(
        403,
        "policy_forbidden",
        "This workspace is not allowed to register an app on a private address.",
    )


def refuse_socket_agent() -> AppError:
    return AppError(
        403,
        "policy_forbidden",
        "This workspace is not allowed to connect agents over a socket.",
    )


def refuse_scopes(scopes: list[str]) -> AppError:
    return AppError(
        403,
        "policy_forbidden",
        f"A server administrator has blocked {', '.join(sorted(scopes))} in this workspace.",
    )


def refuse_app_limit(limit: int) -> AppError:
    return AppError(
        403,
        "policy_forbidden",
        f"This workspace has reached its limit of {limit} apps.",
    )
