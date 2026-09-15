"""Making sure a workspace has Janus, when Janus is running beside us.

The shape is `services/workspace_agent.py`'s and the reasoning is the same: an agent that
has to be registered by hand is an agent a team may never get. The differences are the two
that matter.

It is installed **untrusted**. The built-in agent is Blob's own code and is seeded
`trusted=True`; Janus is somebody else's, so it holds granted scopes like any app and
`validate_manifest` refuses anything a manifest off the wire could not claim.

Its signing secret **comes from the environment**. Blob normally mints one at install and
shows it once, which cannot work here: the container's environment is written before Blob
starts, so a value invented afterwards could never reach it. One value in the operator's
`.env`, read by both sides, is how the two agree with no orchestration step.

The URL is internal — `http://janus:8642/v1/agui` on the `blob-agents` network — and it
never meets `_assert_reachable`, the SSRF guard on the registration *routes*. That is not
an exemption anybody passes: `registry.install` has never looked at a URL, so a caller
that starts here is outside the guard by construction. An admin typing the same URL into
`POST /api/admin/plugins` is still refused, and `tests/test_janus_agent.py` pins it.
"""

from __future__ import annotations

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.errors import AppError
from ..plugins import registry
from ..plugins.manifest import Manifest
from . import workspace_agent

log = logging.getLogger("blob.janus_agent")

#: Fixed. The seeder matches on it to stay idempotent and the bot's address derives from
#: it, so it is not something to make configurable — the display name is.
AGENT_SLUG = "janus"

#: Fixed too, and load-bearing beyond the manifest: with the slug it is what tells this
#: service's row apart from the other rows that can wear the name. See `existing_id`.
AGENT_RUNTIME = "external"

AGENT_DESCRIPTION = "Janus, running beside Blob. Mention it in any channel to ask something."

#: Verbatim from Janus's own `blob-app.json`. Not widened here: a grant an admin revoked
#: must stay revoked across a restart, which is why `ensure` does not reconcile grants.
AGENT_SCOPES = ["messages:read", "messages:write", "channels:read", "channels:join"]


def configured() -> bool:
    """Both halves, or nothing. A URL with no secret cannot authenticate a run, and a
    secret with no URL has nothing to call."""
    return bool(settings.JANUS_AGUI_URL and settings.JANUS_SIGNING_SECRET)


def manifest() -> Manifest:
    return Manifest(
        slug=AGENT_SLUG,
        name=settings.JANUS_AGENT_NAME,
        description=AGENT_DESCRIPTION,
        runtime=AGENT_RUNTIME,
        version="1.0.0",
        agui_url=settings.JANUS_AGUI_URL,
        scopes=list(AGENT_SCOPES),
    )


async def existing_id(session: AsyncSession, workspace_id: str) -> str | None:
    """The row this service owns — never merely a row wearing its slug.

    The slug alone is not identity, and matching on it alone adopts rows that must not be
    touched. `services/workspace_agent.existing_id` matches slug *and* runtime for this
    same reason, and here there are two live ones:

    A `runtime = 'container'` janus row — one production instance has one — is re-healed
    by `jobs/deployments.py`, which rewrites every container row's `agui_url` from the
    runner at worker startup and again every ten minutes. Adopt it and the address flaps:
    boot writes the internal URL, the sync writes the public one back, and the migration
    never sticks.

    A member's own socket agent named "Janus" gets this slug too, because
    `routers/my_agents.py` derives the slug from the name. Adopting that one would be the
    server reaching into somebody's private agent and writing an `agui_url` onto a row the
    routes forbid to have one.

    So: a workspace agent rather than a person's (`owner_user_id IS NULL`, ADR 0018), with
    the runtime this service installs. Anything else holding the slug is somebody else's.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT id FROM plugins
                 WHERE workspace_id = :ws
                   AND slug = :slug
                   AND runtime = :runtime
                   AND owner_user_id IS NULL
                """
            ),
            {"ws": workspace_id, "slug": AGENT_SLUG, "runtime": AGENT_RUNTIME},
        )
    ).fetchone()
    return str(row.id) if row else None


async def ensure(session: AsyncSession, workspace_id: str, *, installed_by: str) -> str | None:
    """Install Janus if it is missing, and put it in the public channels.

    Returns the plugin id; None when Janus is not running, and None when the slug is held
    by a row this service does not own.
    """
    if not configured():
        return None

    plugin_id = await existing_id(session, workspace_id)
    bot_user_id: str | None
    if plugin_id is not None:
        # Production already holds a `janus` row pointing at a public domain. Moved rather
        # than reinstalled: `uninstall` retires the bot — deactivated, handle released,
        # address mangled — so remove-and-reinstall would take its history, its channel
        # memberships and its place in the sidebar with it.
        #
        # Only the URL and the secret. Not the name, not the scopes: a grant an admin
        # revoked must stay revoked across a restart, and a name somebody changed is theirs.
        await session.execute(
            text("UPDATE plugins SET agui_url = :url, updated_at = now() WHERE id = :id"),
            {"url": settings.JANUS_AGUI_URL, "id": plugin_id},
        )
        # The secret moves with it, and this is the half that would otherwise be silent.
        # Blob signs an outbound run with `plugin_secrets.signing_secret` — the value
        # minted at install — and only a *fresh* install writes the configured one. So an
        # operator who generates a new JANUS_SIGNING_SECRET, which is exactly what
        # `.env.example` invites, on a workspace that already holds a Blob-minted one gets
        # the container verifying with one value while Blob signs with another: /v1/agui
        # answers 401, every run fails, and nothing on screen points at the secret — it
        # looks precisely like the agent being down. One value in the operator's `.env`,
        # read by both sides, is the whole design of this, and a secret Blob minted
        # earlier and never showed anybody cannot be that value.
        await session.execute(
            text("UPDATE plugin_secrets SET signing_secret = :secret WHERE plugin_id = :id"),
            {"secret": settings.JANUS_SIGNING_SECRET, "id": plugin_id},
        )
        bot_user_id = await registry.bot_user_id(session, plugin_id)
    else:
        try:
            installed = await registry.install(
                session,
                workspace_id=workspace_id,
                manifest=manifest(),
                installed_by=installed_by,
                signing_secret=settings.JANUS_SIGNING_SECRET,
            )
        except AppError as exc:
            if exc.code != "plugin_exists":
                raise
            # The slug is taken by a row `existing_id` refused to adopt — a container
            # agent, or somebody's personal one called "Janus". Not ours to move, and not
            # a reason to stop: this runs from a loop over every workspace at boot, so
            # raising here would cost every workspace after this one its agent because of
            # one workspace's name clash. `install` refuses before it writes anything, so
            # the caller's transaction is still good.
            log.warning(
                "workspace %s already has a `%s` app that this seeder does not own; skipped",
                workspace_id,
                AGENT_SLUG,
            )
            return None
        plugin_id = installed.plugin_id
        bot_user_id = installed.bot_user_id

    if bot_user_id:
        # A seeded agent in no channels is a silent one. A mention in a channel the bot is
        # not in fails `assert_channel_access(require_member=True)` and is dropped with no
        # message, no error and no run row — indistinguishable from the agent being down,
        # and a failure this project has already had with this agent. Public channels
        # only, for the reason `workspace_agent` states: a private channel's membership is
        # what makes it private, and adding anyone to it is the members' call, not the
        # server's.
        await workspace_agent.join_public_channels(session, workspace_id, bot_user_id)
    return plugin_id


async def ensure_everywhere() -> int:
    """Reconcile every workspace. Returns how many gained the agent.

    Runs at startup, because `JANUS_AGUI_URL` arrives as an environment variable and the
    moment it changes *is* a restart — so a server that has been running for a month gains
    the agent for the workspaces already on it, not only for new ones.

    **One transaction per workspace, not one for all of them.** A failure is logged and
    skipped, and a shared session could not survive that: the first error leaves the
    session in a failed transaction and every workspace after it fails too, turning the
    "skip one" this is written for into "skip the rest".
    """
    if not configured():
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
                    """
                )
            )
        ).fetchall()

    seeded = 0
    for row in rows:
        if row.owner_id is None:
            continue  # A workspace with no owner is mid-teardown; leave it alone.
        try:
            async with transaction() as (session, _):
                before = await existing_id(session, str(row.id))
                after = await ensure(session, str(row.id), installed_by=str(row.owner_id))
                # Both halves. `ensure` returns None when the slug is held by a row it
                # does not own, and a count that read "missing before" as "seeded now"
                # would report an agent the workspace did not get.
                if before is None and after is not None:
                    seeded += 1
        except Exception:
            log.exception("could not seed Janus for workspace %s", row.id)
    return seeded


__all__ = [
    "AGENT_RUNTIME",
    "AGENT_SCOPES",
    "AGENT_SLUG",
    "configured",
    "ensure",
    "ensure_everywhere",
    "existing_id",
    "manifest",
]
