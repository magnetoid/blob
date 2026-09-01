"""Message search.

Postgres full-text search, deliberately behind one interface so swapping in Meilisearch
later touches this file only. At this scale it will never need to be.

The join against channel_members is the security boundary — it is what stops
private-channel content appearing in someone else's results. It is not optional, and
there is a test that fails if it is removed.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request
from ..schemas.models import Message
from .serialize import MESSAGE_SELECT, to_message


@dataclass(slots=True)
class SearchCursor:
    """Where the previous page stopped, as the sort key it stopped on.

    Both halves are needed. `ts_rank` reports a coarse score, so a common word leaves
    thousands of messages sharing one rank; a cursor holding the rank alone would skip
    every one of its ties or repeat all of them. The id is the tiebreaker the ordering
    already uses, so carrying it makes the boundary exact.
    """

    rank: float
    message_id: str

    def encode(self) -> str:
        # `repr` rather than a fixed number of decimal places: a float that does not
        # round-trip exactly comes back as a slightly different cursor, and a slightly
        # different cursor lands between two rows instead of on one.
        return f"{self.rank!r}:{self.message_id}"

    @staticmethod
    def decode(raw: str) -> SearchCursor:
        rank, _, message_id = raw.partition(":")
        try:
            return SearchCursor(rank=float(rank), message_id=str(UUID(message_id)))
        except ValueError:
            # A cursor is opaque and always came from us, so a malformed one is a bug or
            # a hand-edited URL. Refusing beats silently answering a different question.
            raise bad_request("That search cursor is not one we issued.") from None


#: What `has:` accepts. The search SQL branches on exactly these two.
HAS_VALUES = ("link", "file")


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
    before: datetime | None = None
    after: datetime | None = None


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
                # Refused, not dropped. This was the one modifier that could fail
                # quietly: `has:files` matched the case, failed the value check, and
                # vanished — leaving a search that looked filtered and was not, which is
                # the same way `from:` used to answer with the whole workspace. A bad
                # date already answers 400 and this is the same kind of mistake, a fixed
                # vocabulary mistyped, so it gets the same answer and names the words
                # that work.
                if value not in HAS_VALUES:
                    raise bad_request(
                        f"'{value}' is not something a message can have. "
                        f"Use {' or '.join(f'has:{v}' for v in HAS_VALUES)}."
                    )
                parsed.has = value
            case "before":
                parsed.before = _day_start(value)
            case "after":
                # Slack's `after:` excludes the named day, so the boundary is the
                # start of the day after it.
                parsed.after = _day_start(value) + timedelta(days=1)
            case _:
                words.append(token)

    parsed.text = " ".join(words).strip()
    return parsed


def _day_start(value: str) -> datetime:
    """A date the SQL parameter will accept, refused as input rather than as a 500.

    The value lands in `CAST(:x AS timestamptz)`, for which asyncpg insists on a real
    datetime — a string here raised before the query even reached Postgres, so *every*
    dated search was a `500 internal`, and a typo'd one doubly so. A caller's typo is
    a 400 by contract.
    """
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise bad_request(f"'{value}' is not a date. Use YYYY-MM-DD.") from None
    return datetime(day.year, day.month, day.day, tzinfo=UTC)


async def search(
    session: AsyncSession,
    *,
    workspace_id: str,
    user_id: str,
    query: str,
    author_id: str | None = None,
    channel_id: str | None = None,
    before: datetime | None = None,
    after: datetime | None = None,
    has: str | None = None,
    limit: int = 25,
    cursor: SearchCursor | None = None,
) -> tuple[list[Message], int, SearchCursor | None]:
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
                  SELECT id, rank
                    FROM filtered
                   -- Keyset, not OFFSET: the page after the cursor is the rows that
                   -- sort strictly below it, which is one row comparison and no
                   -- re-scan of everything already shown. `rank` alone does not
                   -- separate rows — thousands of messages tie on it — so the id
                   -- breaks the tie in both the ordering and the comparison, and the
                   -- two have to agree exactly or a page boundary drops a row.
                   WHERE (cast(:cursor_rank AS double precision) IS NULL
                          OR (rank::double precision, id)
                             < (cast(:cursor_rank AS double precision),
                                cast(:cursor_id AS uuid)))
                   ORDER BY rank DESC,
                            id DESC
                   LIMIT :limit
                )
                SELECT {MESSAGE_SELECT}, (SELECT count(*) FROM filtered)::int AS total,
                       hits.rank::double precision AS hit_rank
                  FROM messages m
                  JOIN hits ON hits.id = m.id
                 ORDER BY hits.rank DESC, m.id DESC
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
                "cursor_rank": cursor.rank if cursor else None,
                "cursor_id": cursor.message_id if cursor else None,
            },
        )
    ).fetchall()

    total = rows[0].total if rows else 0
    # Only when the page is full. A short page is the end of the results, and offering
    # to continue past it costs a request that can only come back empty.
    next_cursor = (
        SearchCursor(rank=rows[-1].hit_rank, message_id=str(rows[-1].id))
        if len(rows) == limit
        else None
    )
    return [to_message(row) for row in rows], total, next_cursor
