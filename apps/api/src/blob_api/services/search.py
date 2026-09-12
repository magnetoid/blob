"""Message search.

Postgres full-text search, deliberately behind one interface so swapping in Meilisearch
later touches this file only. At this scale it will never need to be.

The join against channel_members is the security boundary — it is what stops
private-channel content appearing in someone else's results. It is not optional, and
there is a test that fails if it is removed.

Two orderings, because "find the thing I remember" and "what was said about this
lately" are different questions and Slack answers both: `relevance` ranks by
`ts_rank`, `newest` by id — which is the same thing as by time, since ids are UUIDv7.
Each carries its own cursor shape, so a page from one ordering can never be continued
in the other.

Both the index and the query fold accents (`blob_unaccent`, migration 0030): a team
writing Serbian, German or French types without diacritics half the time, and a search
that answers nothing to `sta` while the channel is full of `šta` is a search people
stop using. Stemming stays English — it is the language most of these workspaces write
code in, and English suffix stripping leaves other languages' words alone.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request
from ..schemas.models import Message
from .serialize import MESSAGE_SELECT, to_message

#: How results are ordered. `relevance` is the default, as it is in Slack.
SORTS = ("relevance", "newest")

_PREFIX_SAFE = re.compile(r"[^0-9A-Za-z]+")


def prefix_lexeme(query: str) -> str | None:
    """`deplo:*` for the last token, so a partial word still hits the tsvector.

    Quoted tokens and junk that would not be a tsquery lexeme are skipped: a bad
    `to_tsquery` argument 500s the search, which is worse than missing a prefix hit.
    """
    tokens = query.split()
    if not tokens:
        return None
    last = tokens[-1]
    if last[:1] == '"' or last[-1:] == '"':
        return None
    safe = _PREFIX_SAFE.sub("", last)
    if len(safe) < 2:
        return None
    return f"{safe}:*"


def ilike_needle(query: str) -> str | None:
    """Substring fallback for short queries; `%`/`_` in the input stay literal."""
    stripped = query.strip()
    if not (2 <= len(stripped) <= 64):
        return None
    return stripped.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass(slots=True)
class SearchCursor:
    """Where the previous page stopped, as the sort key it stopped on.

    For `relevance` both halves are needed. `ts_rank` reports a coarse score, so a
    common word leaves thousands of messages sharing one rank; a cursor holding the
    rank alone would skip every one of its ties or repeat all of them. The id is the
    tiebreaker the ordering already uses, so carrying it makes the boundary exact. For
    `newest` the id *is* the sort key and `rank` is None — which also makes the two
    cursor shapes distinguishable, so a cursor cannot be replayed into the other
    ordering and quietly answer a different question.
    """

    message_id: str
    rank: float | None = None

    def encode(self) -> str:
        # `repr` rather than a fixed number of decimal places: a float that does not
        # round-trip exactly comes back as a slightly different cursor, and a slightly
        # different cursor lands between two rows instead of on one.
        if self.rank is None:
            return f"n:{self.message_id}"
        return f"{self.rank!r}:{self.message_id}"

    @staticmethod
    def decode(raw: str) -> SearchCursor:
        head, _, rest = raw.partition(":")
        try:
            if head == "n":
                return SearchCursor(message_id=str(UUID(rest)))
            return SearchCursor(rank=float(head), message_id=str(UUID(rest)))
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

    def scoped(self) -> bool:
        """True when a modifier is present, even with no free text.

        `from:@ana` is a complete question. Treating it as empty because there
        are no leftover words is what made modifiers-alone return nothing.
        """
        return bool(self.author or self.channel or self.has or self.before or self.after)


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


async def resolve_author(session: AsyncSession, workspace_id: str, name: str) -> str | None:
    """Who `from:@name` means, or None when it names nobody — or more than one person.

    People type the name they say out loud, and display names are full names. Exact
    wins; a prefix is only accepted when it names exactly one person, because guessing
    between two would answer a question nobody asked. LIMIT 2 tells "one" from "more
    than one" without counting the table.
    """
    candidates = (
        await session.execute(
            text(
                """
                SELECT id FROM users
                 WHERE workspace_id = :ws
                   AND deactivated_at IS NULL
                   AND (lower(display_name) = lower(:name)
                        OR lower(display_name) LIKE lower(:name) || ' %')
                 ORDER BY (lower(display_name) = lower(:name)) DESC
                 LIMIT 2
                """
            ),
            {"ws": workspace_id, "name": name},
        )
    ).fetchall()
    return str(candidates[0].id) if len(candidates) == 1 else None


async def resolve_channel(session: AsyncSession, workspace_id: str, name: str) -> str | None:
    """Which channel `in:#name` means, or None. Membership is the search's own filter."""
    row = (
        await session.execute(
            text("SELECT id FROM channels WHERE workspace_id = :ws AND lower(name) = lower(:name)"),
            {"ws": workspace_id, "name": name},
        )
    ).fetchone()
    return str(row.id) if row else None


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
    sort: str = "relevance",
) -> tuple[list[Message], int, SearchCursor | None]:
    newest_first = sort == "newest"
    if cursor is not None and (cursor.rank is None) != newest_first:
        # The page after a relevance cursor is not the page after a recency one.
        raise bad_request("That search cursor belongs to a different ordering.")
    # `from:@ana` with no leftover words is a complete question. An empty tsquery
    # matches nothing, so the FTS clause has to stand aside and let the modifiers
    # be the whole filter. Rank is then zero and relevance degenerates to recency,
    # which is the honest order when there is nothing to rank against.
    textless = not query.strip()
    # Two keysets, one statement. Each is "the rows that sort strictly below the cursor",
    # which is one row comparison and no re-scan of what has already been shown.
    hits = (
        """
                  SELECT id, rank
                    FROM filtered
                   WHERE (cast(:cursor_id AS uuid) IS NULL
                          OR id < cast(:cursor_id AS uuid))
                   ORDER BY id DESC
                   LIMIT :limit
        """
        if newest_first
        else """
                  SELECT id, rank
                    FROM filtered
                   -- `rank` alone does not separate rows — thousands of messages tie on
                   -- it — so the id breaks the tie in both the ordering and the
                   -- comparison, and the two have to agree exactly or a page boundary
                   -- drops a row.
                   WHERE (cast(:cursor_rank AS double precision) IS NULL
                          OR (rank::double precision, id)
                             < (cast(:cursor_rank AS double precision),
                                cast(:cursor_id AS uuid)))
                   ORDER BY rank DESC,
                            id DESC
                   LIMIT :limit
        """
    )
    order = "ORDER BY m.id DESC" if newest_first else "ORDER BY hits.rank DESC, m.id DESC"
    rows = (
        await session.execute(
            text(
                f"""
                WITH filtered AS (
                  SELECT
                    m.id,
                    CASE WHEN CAST(:textless AS boolean) THEN 0::float4
                         ELSE ts_rank(m.search_tsv,
                            websearch_to_tsquery('english', blob_unaccent(:query)))
                    END AS rank
                    FROM messages m
                    JOIN channel_members cm
                      ON cm.channel_id = m.channel_id
                     AND cm.user_id = :user_id          -- the security boundary
                   WHERE m.workspace_id = :workspace_id
                     AND m.deleted_at IS NULL
                     AND (
                           CAST(:textless AS boolean)
                        OR m.search_tsv @@ websearch_to_tsquery('english', blob_unaccent(:query))
                        OR (cast(:prefix AS text) IS NOT NULL
                            AND m.search_tsv @@ to_tsquery('english', :prefix))
                        OR (cast(:needle AS text) IS NOT NULL
                            AND blob_unaccent(m.body)
                                ILIKE '%' || blob_unaccent(:needle) || '%' ESCAPE '\\')
                     )
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
                  -- Keyset, never OFFSET (ADR 0003).
                  {hits}
                )
                SELECT {MESSAGE_SELECT}, (SELECT count(*) FROM filtered)::int AS total,
                       hits.rank::double precision AS hit_rank
                  FROM messages m
                  JOIN hits ON hits.id = m.id
                 {order}
                """
            ),
            {
                "workspace_id": workspace_id,
                "user_id": user_id,
                "query": query,
                "textless": textless,
                "prefix": prefix_lexeme(query),
                "needle": ilike_needle(query),
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
        SearchCursor(
            message_id=str(rows[-1].id),
            rank=None if newest_first else rows[-1].hit_rank,
        )
        if len(rows) == limit
        else None
    )
    return [to_message(row) for row in rows], total, next_cursor
