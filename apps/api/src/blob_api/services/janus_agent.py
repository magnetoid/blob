"""Making sure a workspace has Janus, when Janus is running beside us.

Janus is the agent Blob ships with, and it is seeded rather than registered by hand for
the reason a workspace has one at all: an agent a team has to install themselves is an
agent they may never get. It is nonetheless somebody else's program, installed through the
ordinary path with no exemption — it holds granted scopes like any app, and
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
from . import seeded
from .channels import add_members

log = logging.getLogger("blob.janus_agent")

#: Re-exported rather than defined here: `services/channels.create_channel` reads the
#: identity too, and this module imports `channels.add_members`, so the definition lives
#: in `services/seeded.py` where both can read it. Bound as module attributes, so
#: `janus_agent.SEEDED_AGENT` and `janus_agent.AGENT_SLUG` still answer for every caller
#: that has always asked here.
AGENT_SLUG = seeded.AGENT_SLUG
AGENT_RUNTIME = seeded.AGENT_RUNTIME
SEEDED_AGENT = seeded.SEEDED_AGENT
is_seeded_row = seeded.is_seeded_row

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
    touched — here there are two live ones:

    A `runtime = 'container'` janus row — one production instance had one until
    2026-09-15 — is re-healed by `jobs/deployments.py`, which rewrites every container
    row's `agui_url` from the runner at worker startup and again every ten minutes. Adopt
    it and the address flaps:
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
                f"""
                SELECT p.id FROM plugins p
                 WHERE p.workspace_id = :ws
                   AND {SEEDED_AGENT}
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchone()
    return str(row.id) if row else None


async def ensure(session: AsyncSession, workspace_id: str, *, installed_by: str) -> str | None:
    """Install Janus if it is missing, point it at the configured address if it is not,
    and — if the workspace still wants it everywhere — put it in the public channels.

    Returns the plugin id; None when Janus is not running, and None when the slug is held
    by a row this service does not own.
    """
    if not configured():
        return None

    plugin_id = await existing_id(session, workspace_id)
    bot_user_id: str | None
    if plugin_id is None:
        installed = await _install(session, workspace_id, installed_by=installed_by)
        if installed is None:
            return None
        plugin_id = installed.plugin_id
        bot_user_id = installed.bot_user_id
        # A fresh install is flagged on by `_install`, so the backfill is what "everywhere"
        # means for it rather than a second decision.
        wants_every_room = True
    else:
        await _repoint(session, plugin_id)
        bot_user_id = await registry.bot_user_id(session, plugin_id)
        # An admin may have chosen invitation-only since the last boot. This runs from
        # `ensure_everywhere` at *every* start, so an unconditional backfill was a switch
        # that came back on with the next deploy — the flag undone by the thing that
        # honours it.
        wants_every_room = await _wants_every_public_channel(session, plugin_id)

    if bot_user_id and wants_every_room:
        await join_public_channels(session, workspace_id, bot_user_id)
    return plugin_id


async def _wants_every_public_channel(session: AsyncSession, plugin_id: str) -> bool:
    """The switch as the workspace last left it — `POST /api/admin/plugins/{id}/everywhere`."""
    row = (
        await session.execute(
            text("SELECT in_every_public_channel FROM plugins WHERE id = :id"),
            {"id": plugin_id},
        )
    ).fetchone()
    return bool(row and row.in_every_public_channel)


async def _install(
    session: AsyncSession, workspace_id: str, *, installed_by: str
) -> registry.Installed | None:
    """A fresh install, or None when the slug is taken by a row that is not ours.

    That row is one `existing_id` refused to adopt — a container agent, or somebody's
    personal one called "Janus". Not ours to move, and not a reason to stop: this runs
    from a loop over every workspace at boot, so raising here would cost every workspace
    after this one its agent because of one workspace's name clash. `install` refuses
    before it writes anything, so the caller's transaction is still good.
    """
    try:
        return await registry.install(
            session,
            workspace_id=workspace_id,
            manifest=manifest(),
            installed_by=installed_by,
            signing_secret=settings.JANUS_SIGNING_SECRET,
            in_every_public_channel=True,
            answers_dm_without_mention=True,
        )
    except AppError as exc:
        if exc.code != "plugin_exists":
            raise
        log.warning(
            "workspace %s already has a `%s` app that this seeder does not own; skipped",
            workspace_id,
            AGENT_SLUG,
        )
        return None


async def _repoint(session: AsyncSession, plugin_id: str) -> None:
    """Move a row installed earlier onto the configured address and secret.

    Production already held a `janus` row pointing at a public domain. Moved rather than
    reinstalled: `uninstall` retires the bot — deactivated, handle released, address
    mangled — so remove-and-reinstall would take its history, its channel memberships and
    its place in the sidebar with it.

    Only the URL and the secret. Not the name, not the scopes: a grant an admin revoked
    must stay revoked across a restart, and a name somebody changed is theirs.

    The secret is the half that would otherwise be silent. Blob signs an outbound run with
    `plugin_secrets.signing_secret` — the value minted at install — and only a *fresh*
    install writes the configured one. So an operator who generates a new
    JANUS_SIGNING_SECRET, which is exactly what `.env.example` invites, on a workspace
    that already holds a Blob-minted one gets the container verifying with one value
    while Blob signs with another: /v1/agui answers 401, every run fails, and nothing on
    screen points at the secret — it looks precisely like the agent being down. One value
    in the operator's `.env`, read by both sides, is the whole design of this, and a
    secret Blob minted earlier and never showed anybody cannot be that value.
    """
    await session.execute(
        text("UPDATE plugins SET agui_url = :url, updated_at = now() WHERE id = :id"),
        {"url": settings.JANUS_AGUI_URL, "id": plugin_id},
    )
    await session.execute(
        text("UPDATE plugin_secrets SET signing_secret = :secret WHERE plugin_id = :id"),
        {"secret": settings.JANUS_SIGNING_SECRET, "id": plugin_id},
    )


async def join_public_channels(session: AsyncSession, workspace_id: str, bot_user_id: str) -> None:
    """Every public channel the bot is not already in.

    Joining at all is the decision worth stating. A seeded agent in no channels is a silent
    one: a mention in a channel the bot is not in fails
    `assert_channel_access(require_member=True)` in `jobs/agui_outcome.py` and is dropped
    with no message, no error and no run row — indistinguishable from the agent being
    down, and a failure this project has already had. Slack's own assistant is reachable
    everywhere rather than invited room by room, and an agent nobody remembered to add is
    an agent nobody uses. It only ever *speaks* when mentioned, so being present costs a
    line in the member list and nothing else — and a channel that does not want it can
    remove it, which is one decision a team makes once rather than a hundred small ones
    they have to make before they get any value.

    Private channels are not joined, ever, and not because of a technical limit. A private
    channel's membership is the thing that makes it private; adding anyone to it — a bot
    included — is the members' call, not the server's.

    This is the join at seeding, for the channels that already exist. The ones founded
    afterwards are joined as they are founded, by `channels.create_channel`, which reads
    the `in_every_public_channel` flag the seeder sets at install — so "everywhere" holds
    without waiting for a restart.

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
    """Reconcile every workspace at boot. Returns how many gained the agent.

    This is what runs at startup. The setting that turns the seeder on — `JANUS_AGUI_URL`
    — arrives as an environment variable, so the moment it changes *is* a restart;
    reconcile anywhere else and a server that has been running for a month gains the agent
    for new workspaces and not for the ones already using it.

    Every workspace is visited, not only the ones without the agent: this is also what
    moves an already-installed Janus off a public domain onto the internal address.

    **It never raises**, for the same reason: a workspace that cannot seed its agent must
    not stop the boot, and neither may a database that cannot list the workspaces. Both
    are logged.

    **One transaction per workspace, not one for all of them.** A workspace that cannot be
    seeded is logged and skipped, and a shared session could not survive that: the first
    error leaves the session in a failed transaction and every workspace after it fails
    too, turning the "skip one" this is written for into "skip the rest". Opening its own
    sessions is also why this takes none — a caller cannot hand in one it will reuse.

    Counted by the difference, not by the answer: `ensure` returns the id of a row that
    was already there, and returns None when it seeded nothing, so a tally that read
    "missing before" as "seeded now" would report an agent the workspace did not get.
    """
    if not configured():
        return 0

    try:
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
    except Exception:
        log.exception("could not list the workspaces to seed Janus into")
        return 0

    # Not `seeded`: that is the name of the module this one imports for the agent's
    # identity, and a local of the same name would shadow it — silently here, and as an
    # `UnboundLocalError` the day a line above this one reads `seeded.SEEDED_AGENT`.
    installed = 0
    for row in rows:
        if row.owner_id is None:
            continue  # A workspace with no owner is mid-teardown; leave it alone.
        workspace_id, owner_id = str(row.id), str(row.owner_id)
        try:
            async with transaction() as (session, _):
                before = await existing_id(session, workspace_id)
                after = await ensure(session, workspace_id, installed_by=owner_id)
        except Exception:
            log.exception("could not seed Janus into workspace %s", workspace_id)
            continue
        if before is None and after is not None:
            installed += 1
    if installed:
        log.info("seeded Janus into %d workspace(s)", installed)
    return installed


__all__ = [
    "AGENT_RUNTIME",
    "AGENT_SCOPES",
    "AGENT_SLUG",
    "configured",
    "ensure",
    "ensure_everywhere",
    "existing_id",
    "join_public_channels",
    "manifest",
]
