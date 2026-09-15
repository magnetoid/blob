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

The boot-time pass over every workspace and the joining of public channels are not this
module's: `services/agent_seeding.py` holds both, shared with the Janus seeder.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib import llm
from ..plugins import builtin, registry
from ..plugins.manifest import Manifest
from . import agent_seeding

#: What the bot is called, and so what people type to reach it. Short on purpose: this is
#: typed mid-sentence, several times a day, by people who are mid-thought.
AGENT_NAME = "Blob"

AGENT_DESCRIPTION = "Blob's own assistant. Mention it in any channel to ask something."

#: What it is granted. The four are what its tools need and nothing more: it reads
#: channels and threads, searches, answers where it was asked, and can say who is here.
#: `users:read` is the newest and is read-only — it lists display names, which is what a
#: mention is written from, so without it the agent can read every channel the asker can
#: and still not name a single person in them. Notably still absent: `messages:moderate`,
#: anything about files, and anything that writes to a member. An agent that ships turned
#: on should hold the smallest set that makes it work, and widen only when a feature
#: actually needs it — which is why widening it is a migration (`0036`) rather than a
#: silent re-grant at startup: `ensure` deliberately does not reconcile grants, because a
#: grant an admin revoked must stay revoked across a restart.
AGENT_SCOPES = ["messages:read", "messages:write", "channels:read", "users:read"]


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

    Returns the plugin id, or None when there is no model to run it against. Why every
    public channel and never a private one is argued once, on
    `agent_seeding.join_public_channels`.
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
            in_every_public_channel=True,
            answers_dm_without_mention=True,
        )
        plugin_id = installed.plugin_id
        bot_user_id = installed.bot_user_id
    else:
        bot_user_id = await registry.bot_user_id(session, plugin_id)

    if bot_user_id:
        await agent_seeding.join_public_channels(session, workspace_id, bot_user_id)
    return plugin_id


async def ensure_everywhere() -> int:
    """Reconcile every workspace at boot. Returns how many gained an agent.

    Only the workspaces with no `blob-agent` plugin at all are visited: this seeder never
    changes a row it installed earlier, so there is nothing for it to do anywhere else.
    """
    if not llm.configured():
        return 0
    return await agent_seeding.reconcile_everywhere(
        "the built-in agent",
        existing_id=existing_id,
        ensure=ensure,
        lacking_slug=builtin.WORKSPACE_SLUG,
    )


__all__ = [
    "AGENT_NAME",
    "AGENT_SCOPES",
    "ensure",
    "ensure_everywhere",
    "existing_id",
    "manifest",
]
