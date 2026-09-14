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
from ..plugins import registry
from ..plugins.manifest import Manifest

log = logging.getLogger("blob.janus_agent")

#: Fixed. The seeder matches on it to stay idempotent and the bot's address derives from
#: it, so it is not something to make configurable — the display name is.
AGENT_SLUG = "janus"

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
        runtime="external",
        version="1.0.0",
        agui_url=settings.JANUS_AGUI_URL,
        scopes=list(AGENT_SCOPES),
    )


async def existing_id(session: AsyncSession, workspace_id: str) -> str | None:
    row = (
        await session.execute(
            text("SELECT id FROM plugins WHERE workspace_id = :ws AND slug = :slug"),
            {"ws": workspace_id, "slug": AGENT_SLUG},
        )
    ).fetchone()
    return str(row.id) if row else None


async def ensure(session: AsyncSession, workspace_id: str, *, installed_by: str) -> str | None:
    """Install Janus if it is missing. Returns the plugin id, or None when it is not running."""
    if not configured():
        return None

    plugin_id = await existing_id(session, workspace_id)
    if plugin_id is not None:
        return plugin_id

    installed = await registry.install(
        session,
        workspace_id=workspace_id,
        manifest=manifest(),
        installed_by=installed_by,
        signing_secret=settings.JANUS_SIGNING_SECRET,
    )
    return installed.plugin_id


__all__ = ["AGENT_SCOPES", "AGENT_SLUG", "configured", "ensure", "existing_id", "manifest"]
