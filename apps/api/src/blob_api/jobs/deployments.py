"""Keep hosted agents' deployment records honest without anyone watching.

`agents.status` records what the runner reports — deployment state and the callback
URL — but until now it only ran when somebody opened the deployment card in the
console. A domain change in the runner therefore healed the stored `agui_url` only
after a person happened to look at the right screen; every mention in between dialled
the dead address. The worker now does the looking: at startup, because a fresh deploy
is exactly when the record is most likely stale, and on a slow cycle after that.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

from ..config import settings
from ..db.engine import session_scope
from ..services import agents

log = logging.getLogger(__name__)


async def sync_hosted_agents(ctx: dict[str, Any]) -> int:
    """Refresh every hosted agent's deployment record. Returns how many synced."""
    # The same switch the deploy path uses. Hosting off is a normal state; a worker
    # without the runner's address must stay quiet rather than warn every cycle.
    if not settings.agent_hosting_enabled:
        return 0
    async with session_scope() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT id, workspace_id FROM plugins
                     WHERE runtime = 'container' AND deployment_id IS NOT NULL
                     LIMIT 100
                    """
                )
            )
        ).fetchall()

    synced = 0
    for row in rows:
        try:
            await agents.status(str(row.workspace_id), str(row.id))
            synced += 1
        except Exception:
            # One unreachable runner or broken deployment must not stop the rest —
            # the next cycle tries again.
            log.warning("deployment sync failed for plugin %s", row.id, exc_info=True)
    return synced
