"""What an admin tells an installed agent, and what it may do — the rows behind the
controls on its page (`routers/plugin_controls.py`).

Its daily budget, the workspace's instructions, whether it joins every public channel
founded from now on, whether its card shows its reasoning, and what it may do with Blob's
tools. Each is admin-set only and none is a manifest field: an app that could set its own
by shipping an update would make every one of them decorative. Split from
`plugins/registry.py` — what an app *is* — in phase 8 of the agentic review.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .registry import by_id


async def set_budget(
    session: AsyncSession,
    plugin_id: str,
    workspace_id: str,
    *,
    runs_per_day: int | None,
    seconds_per_day: int | None,
    tokens_per_day: int | None = None,
) -> None:
    """Cap what this agent may spend in a trailing day. NULL lifts the cap.

    Admin-set only, and deliberately not a manifest field — an app that could budget
    itself by shipping an update would make the cap decorative.
    """
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text(
            """
            UPDATE plugins
               SET budget_runs_per_day = :runs, budget_seconds_per_day = :seconds,
                   budget_tokens_per_day = :tokens, updated_at = now()
             WHERE id = :id
            """
        ),
        {
            "id": plugin_id,
            "runs": runs_per_day,
            "seconds": seconds_per_day,
            "tokens": tokens_per_day,
        },
    )


async def set_instructions(
    session: AsyncSession, plugin_id: str, workspace_id: str, instructions: str | None
) -> str | None:
    """What this workspace tells its agent, carried with every run. Returns what is now
    stored, so a caller can audit the length without re-reading the row.

    Blank is nothing to say: empty, whitespace-only and absent all store NULL, because a
    run must then send no `instructions` key rather than an empty string an agent would
    prepend to its prompt. Surrounding whitespace is trimmed for the same reason a name
    is — a trailing newline from a textarea is not part of what was meant.

    Admin-set only, like the budget above and for the same reason: an agent that could
    write its own standing instruction by shipping an update would make the field
    decorative.
    """
    await by_id(session, plugin_id, workspace_id)
    stored = (instructions or "").strip() or None
    await session.execute(
        text("UPDATE plugins SET instructions = :instructions, updated_at = now() WHERE id = :id"),
        {"id": plugin_id, "instructions": stored},
    )
    return stored


async def set_in_every_public_channel(
    session: AsyncSession, plugin_id: str, workspace_id: str, enabled: bool
) -> None:
    """Whether this agent's bot joins public channels founded from now on.

    The flag alone: `services/channels.create_channel` reads it at founding and
    `services/janus_agent.ensure` re-reads it at boot, and nothing here walks into rooms
    that already exist or out of them. Today's channels are changed one at a time through
    the channels routes, where each join is visible as itself.

    Not residency. Whether the home view addresses this agent is decided by which agent it
    *is*, not by where it sits — `services/users.list_users`.
    """
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text(
            """
            UPDATE plugins
               SET in_every_public_channel = :enabled, updated_at = now()
             WHERE id = :id
            """
        ),
        {"id": plugin_id, "enabled": enabled},
    )


async def set_shows_reasoning(
    session: AsyncSession, plugin_id: str, workspace_id: str, shown: bool
) -> None:
    """Whether this agent's run cards show the channel a tail of its reasoning.

    A display choice about one agent, made by an admin. The card goes to everyone in the
    channel, so the default is off (migration 0046); an agent whose working-out is worth
    reading — and safe to show — is switched on here.
    """
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text("UPDATE plugins SET shows_reasoning = :shown, updated_at = now() WHERE id = :id"),
        {"id": plugin_id, "shown": shown},
    )


async def set_write_approval(
    session: AsyncSession, plugin_id: str, workspace_id: str, approval: str
) -> None:
    """Which of this agent's posts wait for the person (migration 0054).

    The caller checks the value; the table's CHECK is the second line.
    """
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text("UPDATE plugins SET write_approval = :approval, updated_at = now() WHERE id = :id"),
        {"id": plugin_id, "approval": approval},
    )


async def set_tool_access(
    session: AsyncSession, plugin_id: str, workspace_id: str, access: str
) -> None:
    """What this agent may do with Blob's tools (ADR 0022): `none`, `read`, or `write`.

    The caller checks the value; the table's CHECK is the second line. Whether a write
    waits for the person is `write_approval`'s to say, and it waits by default.
    """
    await by_id(session, plugin_id, workspace_id)
    await session.execute(
        text("UPDATE plugins SET tool_access = :access, updated_at = now() WHERE id = :id"),
        {"id": plugin_id, "access": access},
    )
