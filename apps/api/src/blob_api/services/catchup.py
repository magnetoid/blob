"""Catch Me Up: what happened in a channel while you were away, in a paragraph.

The summary is **ephemeral by construction**: it exists only in the HTTP response,
nothing is stored, nothing is broadcast, and nobody else ever learns you asked. The
"post to channel" affordance is the client sending an ordinary message *as the
person* — no bot impersonation, no new permission surface, and idempotent on a
client id derived from the summarised range.

Bounded on every axis somebody else controls: the unread window is capped per
channel, the workspace form summarises at most a handful of channels, and at most a
few model calls run at once. A model failure is a typed error the panel renders,
never a 500 — the same posture as translation, which is the precedent this follows.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib import llm
from ..lib.errors import AppError

#: The most unread messages one summary reads. Beyond this the honest summary is
#: "a lot happened"; the model does not need four hundred messages to say so.
MAX_MESSAGES = 80

#: The workspace form summarises the busiest few, not everything: eight summaries is
#: reading, one per channel someone actually follows is triage.
MAX_CHANNELS = 8

#: Model calls in flight at once. The provider bills per token either way; this
#: bounds latency spikes and connection pressure, not spend.
CONCURRENCY = 3

SYSTEM = (
    "You summarise unread team-chat messages for one reader. Be concrete and short: "
    "2-6 sentences. Lead with decisions and direct requests, name who said what, keep "
    "@names verbatim, and skip pleasantries. If nothing of substance happened, say so "
    "in one sentence."
)


@dataclass(slots=True)
class ChannelSummary:
    channel_id: str
    channel_name: str | None
    text: str
    message_count: int
    #: The newest message the summary covers — what "mark as read" ratchets to, and
    #: half of the idempotency key a posted summary carries.
    up_to_message_id: str


def refuse_unconfigured() -> AppError:
    return AppError(
        400,
        "llm_not_configured",
        "No model is configured for this server, so there is nothing to summarise with.",
    )


async def unread_channels(
    session: AsyncSession, *, workspace_id: str, user_id: str, channel_id: str | None
) -> list[Any]:
    """The channels with something unread, busiest mentions first.

    Membership and the workspace boundary live inside the statement. The UUIDv7
    string comparison against the read cursor is the house trick: "unread" is
    `id > last_read`, no timestamp join anywhere.
    """
    rows = (
        await session.execute(
            text(
                """
                SELECT c.id, c.name, rs.last_read_message_id, rs.mention_count
                  FROM channels c
                  JOIN channel_members cm ON cm.channel_id = c.id AND cm.user_id = :user_id
                  LEFT JOIN read_states rs ON rs.channel_id = c.id AND rs.user_id = :user_id
                 WHERE c.workspace_id = :ws
                   AND c.archived_at IS NULL
                   AND (cast(:channel_id AS uuid) IS NULL OR c.id = cast(:channel_id AS uuid))
                   AND c.last_message_id IS NOT NULL
                   AND (rs.last_read_message_id IS NULL
                        OR c.last_message_id > rs.last_read_message_id)
                 ORDER BY COALESCE(rs.mention_count, 0) DESC, c.last_message_id DESC
                 LIMIT :limit
                """
            ),
            {
                "ws": workspace_id,
                "user_id": user_id,
                "channel_id": channel_id,
                "limit": 1 if channel_id else MAX_CHANNELS,
            },
        )
    ).fetchall()
    return list(rows)


async def unread_messages(
    session: AsyncSession, *, channel_id: str, after_id: str | None
) -> list[Any]:
    rows = (
        await session.execute(
            text(
                """
                SELECT m.id, m.body, m.kind, u.display_name AS author
                  FROM messages m
                  LEFT JOIN users u ON u.id = m.author_id
                 WHERE m.channel_id = :channel_id
                   AND m.deleted_at IS NULL
                   AND m.thread_root_id IS NULL
                   AND (cast(:after AS uuid) IS NULL OR m.id > cast(:after AS uuid))
                 ORDER BY m.id DESC
                 LIMIT :limit
                """
            ),
            {"channel_id": channel_id, "after": after_id, "limit": MAX_MESSAGES},
        )
    ).fetchall()
    # Oldest first, the way a reader would have read them.
    return list(reversed(rows))


async def summarise(
    session: AsyncSession, *, workspace_id: str, user_id: str, channel_id: str | None
) -> list[ChannelSummary]:
    """Summaries for everything unread — one channel when asked, else the busiest few."""
    if not llm.configured():
        raise refuse_unconfigured()

    channels = await unread_channels(
        session, workspace_id=workspace_id, user_id=user_id, channel_id=channel_id
    )
    work: list[tuple[Any, list[Any]]] = []
    for channel in channels:
        messages = await unread_messages(
            session, channel_id=str(channel.id), after_id=channel.last_read_message_id
        )
        if messages:
            work.append((channel, messages))

    semaphore = asyncio.Semaphore(CONCURRENCY)

    async def one(channel: Any, messages: list[Any]) -> ChannelSummary:
        transcript = "\n".join(f"{row.author or 'someone'}: {row.body}" for row in messages)[
            :24_000
        ]
        async with semaphore:
            reply = "".join(
                [
                    delta
                    async for delta in llm.stream_reply(
                        system=SYSTEM,
                        turns=[
                            llm.Turn(
                                role="user",
                                content=(
                                    f"Channel: #{channel.name or 'conversation'}\n"
                                    f"Unread messages ({len(messages)}):\n{transcript}"
                                ),
                            )
                        ],
                        max_tokens=400,
                    )
                ]
            )
        return ChannelSummary(
            channel_id=str(channel.id),
            channel_name=channel.name,
            text=reply.strip(),
            message_count=len(messages),
            up_to_message_id=str(messages[-1].id),
        )

    try:
        results = await asyncio.gather(*(one(c, m) for c, m in work))
    except llm.LlmError as error:
        raise AppError(502, "llm_failed", f"The model could not summarise: {error}") from error
    return [summary for summary in results if summary.text]


__all__ = ["ChannelSummary", "summarise"]
