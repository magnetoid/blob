"""Message search.

Postgres full-text search, deliberately behind one interface so swapping in Meilisearch
later touches this file only. At this scale it will never need to be.

The join against channel_members is the security boundary — it is what stops
private-channel content appearing in someone else's results. It is not optional, and
there is a test that fails if it is removed.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..schemas.models import Message
from .serialize import MESSAGE_SELECT, to_message


@dataclass(slots=True)
class ParsedQuery:
    """Slack-style modifiers pulled out of a raw query string.

    `from:@ana in:#eng has:link before:2026-01-01 deploy failed`
    → from='ana', in='eng', has='link', before=…, text='deploy failed'
    """

    text: str = ""
    author: str | None = None
    channel: str | None = None
    has: str | None = None
    before: str | None = None
    after: str | None = None


def parse_query(raw: str) -> ParsedQuery:
    parsed = ParsedQuery()
    words: list[str] = []

    for token in raw.split():
        key, _, value = token.partition(":")
        if not value:
            if token:
                words.append(token)
            continue
        match key:
            case "from":
                parsed.author = value.lstrip("@")
            case "in":
                parsed.channel = value.lstrip("#")
            case "has":
                if value in ("link", "file"):
                    parsed.has = value
            case "before":
                parsed.before = value
            case "after":
                parsed.after = value
            case _:
                words.append(token)

    parsed.text = " ".join(words).strip()
    return parsed


async def search(
    session: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    query: str,
    author_id: str | None = None,
    channel_id: str | None = None,
    before: str | None = None,
    after: str | None = None,
    has: str | None = None,
    limit: int = 25,
) -> tuple[list[Message], int]:
    rows = (
        await session.execute(
            text(
                f"""
                WITH filtered AS (
                  SELECT
                    m.id,
                    ts_rank(m.search_tsv, websearch_to_tsquery('english', :query)) AS rank
                    FROM messages m
                    JOIN channel_members cm
                      ON cm.channel_id = m.channel_id
                     AND cm.user_id = :user_id          -- the security boundary
                   WHERE m.workspace_id = :workspace_id
                     AND m.deleted_at IS NULL
                     AND m.search_tsv @@ websearch_to_tsquery('english', :query)
                     AND (cast(:author_id AS uuid) IS NULL
                          OR m.author_id = cast(:author_id AS uuid))
                     AND (cast(:channel_id AS uuid) IS NULL
                          OR m.channel_id = cast(:channel_id AS uuid))
                     AND (cast(:before AS timestamptz) IS NULL
                          OR m.created_at < cast(:before AS timestamptz))
                     AND (cast(:after AS timestamptz) IS NULL
                          OR m.created_at > cast(:after AS timestamptz))
                     AND (cast(:has AS text) IS NULL
                          OR (:has = 'link' AND m.body ~* 'https?://')
                          OR (:has = 'file' AND EXISTS (
                                SELECT 1 FROM attachments a WHERE a.message_id = m.id)))
                ),
                hits AS (
                  SELECT id
                    FROM filtered
                   ORDER BY rank DESC,
                            id DESC
                   LIMIT :limit
                )
                SELECT {MESSAGE_SELECT}, (SELECT count(*) FROM filtered)::int AS total
                  FROM messages m
                  JOIN hits ON hits.id = m.id
                 ORDER BY m.id DESC
                """
            ),
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "query": query,
                "author_id": author_id,
                "channel_id": channel_id,
                "before": before,
                "after": after,
                "has": has,
                "limit": limit,
            },
        )
    ).fetchall()

    total = rows[0].total if rows else 0
    return [to_message(row) for row in rows], total
