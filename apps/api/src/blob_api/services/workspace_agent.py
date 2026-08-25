"""Making sure a workspace has the agent Blob runs itself.

Blob's promise is that a team gets an agentic workspace, not a workspace they can bolt an
agent onto. That promise is kept or broken in the first sixty seconds: either `@Blob` is
already in #general when the founder arrives, or it is a setup task they may never do.

So this is seeded rather than offered, and it is seeded through the ordinary install path
with `trusted=True` — the built-in agent is a `plugins` row with a bot in `users`, holding
grants an admin can revoke, and disabling it is the same two clicks as disabling anything
else. The one agent that ships turned on is the last one that should be exempt from the
permission system.

**Idempotent, and it has to be**, because it runs from two places that both mean "make
sure": once when a workspace is founded, and once at startup for every workspace that
already existed. The second is what happens when an operator sets `LLM_PROVIDER` on a
server that has been running for a month — and since that setting arrives as an
environment variable, a restart is exactly when it changes.

**Nothing is seeded when no model is configured.** An agent in the sidebar that answers
every mention with "no model is configured" is worse than no agent: it is a broken feature
where there could have been an absent one.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from ..lib import llm
from ..plugins import builtin, registry
from ..plugins.manifest import Manifest
from .channels import add_members

log = logging.getLogger("blob.workspace_agent")

#: What the bot is called, and so what people type to reach it. Short on purpose: this is
#: typed mid-sentence, several times a day, by people who are mid-thought.
AGENT_NAME = "Blob"

AGENT_DESCRIPTION = "Blob's own assistant. Mention it in any channel to ask something."

#: What it is granted. Reading and writing messages is the whole job today — it answers
#: where it was asked and nowhere else. Notably absent: `messages:moderate`, anything
#: about files, and anything about members. An agent that ships turned on should hold the
#: smallest set that makes it work, and widen only when a feature actually needs it.
AGENT_SCOPES = ["messages:read", "messages:write", "channels:read"]


def manifest() -> Manifest:
    return Manifest(
        slug=builtin.WORKSPACE_SLUG,
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
        runtime=builtin.RUNTIME,
        version="1.0.0",
        scopes=list(AGENT_SCOPES),
    )


async def existing_id(session: AsyncSession, workspace_id: str) -> str | None:
    row = (
        await session.execute(
            text(
                """
                SELECT id FROM plugins
                 WHERE workspace_id = :ws AND slug = :slug AND runtime = :runtime
                """
            ),
            {"ws": workspace_id, "slug": builtin.WORKSPACE_SLUG, "runtime": builtin.RUNTIME},
        )
    ).fetchone()
    return str(row.id) if row else None


async def ensure(session: AsyncSession, workspace_id: str, *, installed_by: str) -> str | None:
    """Install the workspace agent if it is missing, and put it in the public channels.

    Returns the plugin id, or None when there is no model to run it against.

    Joining every public channel is the decision worth stating. Slack's own assistant is
    reachable everywhere rather than invited room by room, and an agent nobody remembered
    to add is an agent nobody uses. It only ever *speaks* when mentioned, so being present
    costs a line in the member list and nothing else — and a channel that does not want it
    can remove it, which is a decision a team can make once rather than a hundred small
    ones they have to make before they get any value.

    Private channels are not joined, ever, and not because of a technical limit. A private
    channel's membership is the thing that makes it private; adding anyone to it — a bot
    included — is the members' call, not the server's.
    """
    if not llm.configured():
        return None

    plugin_id = await existing_id(session, workspace_id)
    bot_user_id: str | None
    if plugin_id is None:
        installed = await registry.install(
            session,
            workspace_id=workspace_id,
            manifest=manifest(),
            installed_by=installed_by,
            trusted=True,
        )
        plugin_id = installed.plugin_id
        bot_user_id = installed.bot_user_id
    else:
        bot_user_id = await registry.bot_user_id(session, plugin_id)

    if bot_user_id:
        await _join_public_channels(session, workspace_id, bot_user_id)
    return plugin_id


async def _join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str) -> None:
    """Every public channel it is not already in.

    Scoped by workspace inside the statement, and `add_members` re-derives the boundary
    from the *channel* anyway — belt and braces on the one path that plants membership
    rows, which is where the workspace boundary has been wrong before.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT c.id FROM channels c
                 WHERE c.workspace_id = :ws
                   AND c.kind = 'public'
                   AND c.archived_at IS NULL
                   AND NOT EXISTS (
                     SELECT 1 FROM channel_members m
                      WHERE m.channel_id = c.id AND m.user_id = :bot)
                """
            ),
            {"ws": workspace_id, "bot": bot_user_id},
        )
    ).fetchall()
    for row in rows:
        await add_members(session, str(row.id), [bot_user_id])


async def ensure_everywhere() -> int:
    """Reconcile every workspace. Returns how many gained an agent.

    Runs at startup, so that turning the model on for a server that has been running for a
    month does not leave every existing workspace without the feature — and so that a
    workspace created before this code existed is not permanently a second-class one.

    **One transaction per workspace, not one for all of them.** A failure here is logged
    and skipped, and a shared session could not survive that: the first error leaves the
    session in a failed transaction and every workspace after it fails too, so the
    "skip one" this is written for would silently become "skip the rest". Opening its own
    sessions is also why it takes none — a caller cannot hand in one it will reuse.
    """
    if not llm.configured():
        return 0

    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT w.id,
                           (SELECT u.id FROM users u
                             WHERE u.workspace_id = w.id AND u.role = 'owner'
                               AND u.deactivated_at IS NULL
                             ORDER BY u.id LIMIT 1) AS owner_id
                      FROM workspaces w
                     WHERE NOT EXISTS (
                       SELECT 1 FROM plugins p
                        WHERE p.workspace_id = w.id AND p.runtime = :runtime)
                    """
                ),
                {"runtime": builtin.RUNTIME},
            )
        ).fetchall()

    seeded = 0
    for row in rows:
        if row.owner_id is None:
            continue  # A workspace with no owner is mid-teardown; leave it alone.
        try:
            async with transaction() as (session, _):
                if await ensure(session, str(row.id), installed_by=str(row.owner_id)):
                    seeded += 1
        except Exception:
            log.exception("could not seed the built-in agent for workspace %s", row.id)
    return seeded


__all__ = ["AGENT_NAME", "AGENT_SCOPES", "ensure", "ensure_everywhere", "existing_id", "manifest"]
