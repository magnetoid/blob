"""Who may open a terminal in an agent, and the record that they did.

`plugins/shell.py` knows how to get a PTY. This knows whether it should: the plugin has
to exist in the asking admin's workspace, it has to be one Blob actually hosts, and the
workspace policy has to allow it. All three are re-checked at the moment the terminal is
opened rather than when the console was loaded, because a console tab can sit open for a
day and a revoked admin should not still have a shell behind it.

The audit entry is written **before** the session opens, not after it closes. A shell
that hangs, a process that is killed, a container that dies mid-session — all of them end
without an "after", and the whole value of this record is that it exists for the sessions
that went wrong. The close is recorded too, with how long it lasted, and its absence next
to an open is itself informative.
"""

from __future__ import annotations

import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from sqlalchemy import text

from ..db.engine import session_scope, transaction
from ..lib.errors import bad_request
from ..plugins import registry, shell
from ..plugins.shell import ShellSession
from ..services import audit as audit_service
from ..services import policies as policy_service
from ..services.audit import Actor

log = logging.getLogger("blob.agents.shell")


@dataclass(slots=True)
class Target:
    """The agent a terminal was asked for, once it is established there is one."""

    plugin_id: str
    name: str
    deployment_id: str


async def resolve_for_bot_user(actor: Actor, user_id: str) -> Target:
    """The agent behind a bot's user row, or the reason there is no terminal for it.

    A conversation names the agent the way a person does — by who it is, not by which
    plugin installed it. `users.bot_plugin_id` is that link, and it is the only extra
    step: everything after it is `resolve`, so a terminal opened from a DM is gated by
    exactly the checks a terminal opened from the console is. There is deliberately no
    second policy path here to drift out of step with the first.
    """
    async with session_scope() as session:
        row = (
            await session.execute(
                text(
                    """
                    SELECT bot_plugin_id FROM users
                     WHERE id = :id AND workspace_id = :ws AND kind = 'bot'
                    """
                ),
                {"id": user_id, "ws": actor.workspace_id},
            )
        ).fetchone()

    # Same answer for "no such user", "a person, not an agent" and "an agent from
    # another workspace": which of those is true is not this caller's business.
    if row is None or not row.bot_plugin_id:
        raise bad_request(
            "There is no agent behind that conversation, so there is nothing to open a "
            "terminal in.",
            code="not_hosted",
        )

    return await resolve(actor, str(row.bot_plugin_id))


async def resolve(actor: Actor, plugin_id: str) -> Target:
    """The agent, or the reason there is no terminal for it."""
    # Configuration first. An agent that is not hosted and a server with no terminal are
    # different problems, and reporting the wrong one sends an operator to edit a row
    # when what is missing is a setting.
    shell.current_shell()

    async with session_scope() as session:
        plugin = await registry.by_id(session, plugin_id, actor.workspace_id)
        # `stored_for`, not `effective_for`, for the same reason `from-repo` reads it:
        # the environment ceiling for the terminal is the AGENT_SHELL settings, and
        # `current_shell()` above already refused with the message that names the
        # missing half. Folding in the *runner* ceiling here would tell an operator
        # whose agent is already running "ask an administrator" — who is them.
        policy = await policy_service.stored_for(session, actor.workspace_id)

    if not policy.may_host_agents:
        # The capability that governs deploying an agent governs getting inside one. They
        # are the same privilege: an operator who can choose what code runs in a container
        # is not meaningfully restrained by being kept out of its shell, and a workspace
        # denied the first should not be handed the second.
        raise policy_service.refuse_hosting()

    deployment_id = getattr(plugin, "deployment_id", None)
    if not deployment_id:
        raise bad_request(
            "That agent runs wherever its author put it, so there is nothing here to open "
            "a terminal in. An agent Blob deployed has one.",
            code="not_hosted",
        )

    return Target(plugin_id=plugin_id, name=plugin.name, deployment_id=str(deployment_id))


@asynccontextmanager
async def open_session(
    actor: Actor, target: Target, *, cols: int, rows: int
) -> AsyncIterator[ShellSession]:
    """A terminal, bracketed by the record that it existed."""
    await _record(actor, target, "plugin.shell_opened", {})
    started = time.monotonic()

    try:
        async with shell.ShellHandle(
            shell.current_shell(), target.deployment_id, cols, rows
        ) as session:
            log.info("terminal opened in %s by %s", target.name, actor.id)
            yield session
    finally:
        await _record(
            actor,
            target,
            "plugin.shell_closed",
            {"seconds": round(time.monotonic() - started, 1)},
        )


async def _record(actor: Actor, target: Target, action: str, extra: dict[str, object]) -> None:
    """Append to the log, and never let failing to do so end the session.

    Deliberate: a terminal that closes because the audit write failed is a worse outcome
    than a gap in the log, and the gap is visible — an open with no close, or a close with
    no open — which is more than a swallowed exception usually leaves behind.
    """
    try:
        async with transaction() as (session, _):
            await audit_service.record(
                session,
                actor,
                action,
                target_type="plugin",
                target_id=target.plugin_id,
                metadata={"agent": target.name, "deployment": target.deployment_id, **extra},
            )
    except Exception:
        log.exception("could not record %s for %s", action, target.plugin_id)


__all__ = ["Target", "open_session", "resolve"]
