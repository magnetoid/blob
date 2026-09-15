"""What the two seeders share.

Two agents are seeded into a workspace rather than registered by hand — the one Blob runs
itself (`workspace_agent.py`) and Janus, when it runs as a service in this stack
(`janus_agent.py`). Each has its own idea of what "make sure" means for one workspace:
what to install, which row counts as its own, what to reconcile on a row it installed
earlier. What they must not each have is a copy of the two things below, because a rule
written twice is a rule with two places to be forgotten in.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import session_scope, transaction
from .channels import add_members

log = logging.getLogger("blob.agent_seeding")


class Ensure(Protocol):
    """A seeder's "make sure" for one workspace.

    Answers the plugin id, or None when there was nothing to seed — no model configured,
    the service not running, the name held by a row that is not the seeder's own.
    """

    def __call__(
        self, session: AsyncSession, workspace_id: str, /, *, installed_by: str
    ) -> Awaitable[str | None]: ...


#: A seeder's "is my row here?": the plugin id, or None.
Lookup = Callable[[AsyncSession, str], Awaitable[str | None]]


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


async def reconcile_everywhere(
    what: str,
    *,
    existing_id: Lookup,
    ensure: Ensure,
    lacking_slug: str | None = None,
) -> int:
    """Run one seeder over every workspace. Returns how many gained the agent.

    This is what runs at startup. Every setting that turns a seeder on — `LLM_PROVIDER`,
    `JANUS_AGUI_URL` — arrives as an environment variable, so the moment it changes *is* a
    restart; reconcile anywhere else and a server that has been running for a month gains
    the agent for new workspaces and not for the ones already using it.

    **It never raises**, for the same reason: a workspace that cannot seed its agent must
    not stop the boot, and neither may a database that cannot list the workspaces. Both
    are logged, and `what` is how the log line names the agent.

    **One transaction per workspace, not one for all of them.** A workspace that cannot be
    seeded is logged and skipped, and a shared session could not survive that: the first
    error leaves the session in a failed transaction and every workspace after it fails
    too, turning the "skip one" this is written for into "skip the rest". Opening its own
    sessions is also why this takes none — a caller cannot hand in one it will reuse.

    `lacking_slug` narrows the pass to workspaces holding no plugin of that slug at all.
    The built-in seeder passes its slug because it never changes a row it installed
    earlier — and that includes which channels the bot is in: a workspace that already has
    the agent is not visited, so a public channel founded after the seeding is one the
    agent has to be invited to. Janus leaves it None and visits every workspace, because
    it also re-points the rows it installed earlier; a side effect is that it joins any
    public channel founded since, at every restart. The prefilter is keyed on the slug and
    not on a runtime on purpose: `registry.install` refuses a taken slug whatever its
    runtime, so a runtime test here would quietly skip a workspace that holds some *other*
    plugin of that runtime and not this one — a prefilter that disagrees with the thing it
    is filtering for.

    Counted by the difference, not by the answer: `ensure` returns the id of a row that
    was already there, and returns None when it seeded nothing, so a tally that read
    "missing before" as "seeded now" would report an agent the workspace did not get.
    """
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
                         WHERE CAST(:slug AS text) IS NULL
                            OR NOT EXISTS (
                                 SELECT 1 FROM plugins p
                                  WHERE p.workspace_id = w.id AND p.slug = :slug)
                        """
                    ),
                    {"slug": lacking_slug},
                )
            ).fetchall()
    except Exception:
        log.exception("could not list the workspaces to seed %s into", what)
        return 0

    seeded = 0
    for row in rows:
        if row.owner_id is None:
            continue  # A workspace with no owner is mid-teardown; leave it alone.
        workspace_id, owner_id = str(row.id), str(row.owner_id)
        try:
            async with transaction() as (session, _):
                before = await existing_id(session, workspace_id)
                after = await ensure(session, workspace_id, installed_by=owner_id)
        except Exception:
            log.exception("could not seed %s into workspace %s", what, workspace_id)
            continue
        if before is None and after is not None:
            seeded += 1
    if seeded:
        log.info("seeded %s into %d workspace(s)", what, seeded)
    return seeded


__all__ = ["Ensure", "Lookup", "join_public_channels", "reconcile_everywhere"]
