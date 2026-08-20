"""Baseline: the schema as the TypeScript server left it.

This revision executes the two original .sql files verbatim rather than a hand-translated
DDL, so the schema is byte-identical to the one already running — including the generated
tsvector column, the five partial indexes and the two GIN indexes.

Databases created by the old TypeScript migration runner should be stamped rather than
migrated:  alembic stamp 0001

Revision ID: 0001
Revises:
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from pathlib import Path

from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SQL_DIR = Path(__file__).resolve().parent.parent / "sql"


def split_statements(sql: str) -> Iterator[str]:
    """Yield individual statements.

    asyncpg refuses multi-statement prepared statements, so a script has to be fed in
    one piece at a time. The splitter tracks single quotes, dollar-quoted blocks and
    line comments so a semicolon inside any of them is not mistaken for a terminator.
    """
    statement: list[str] = []
    in_string = False
    in_line_comment = False
    dollar_tag: str | None = None
    index = 0

    while index < len(sql):
        char = sql[index]
        pair = sql[index : index + 2]

        if in_line_comment:
            statement.append(char)
            if char == "\n":
                in_line_comment = False
            index += 1
            continue

        if dollar_tag is not None:
            statement.append(char)
            if sql.startswith(dollar_tag, index):
                statement.append(sql[index + 1 : index + len(dollar_tag)])
                index += len(dollar_tag)
                dollar_tag = None
            else:
                index += 1
            continue

        if in_string:
            statement.append(char)
            if char == "'":
                # '' is an escaped quote, not a terminator.
                if sql[index + 1 : index + 2] == "'":
                    statement.append("'")
                    index += 2
                    continue
                in_string = False
            index += 1
            continue

        if pair == "--":
            in_line_comment = True
            statement.append(pair)
            index += 2
            continue

        if char == "'":
            in_string = True
            statement.append(char)
            index += 1
            continue

        if char == "$":
            end = sql.find("$", index + 1)
            if end != -1 and sql[index + 1 : end].replace("_", "").isalnum() or end == index + 1:
                dollar_tag = sql[index : end + 1]
                statement.append(dollar_tag)
                index = end + 1
                continue

        if char == ";":
            candidate = "".join(statement).strip()
            if candidate:
                yield candidate
            statement = []
            index += 1
            continue

        statement.append(char)
        index += 1

    tail = "".join(statement).strip()
    if tail:
        yield tail


def _run(filename: str) -> None:
    for statement in split_statements((SQL_DIR / filename).read_text()):
        op.execute(statement)


def upgrade() -> None:
    _run("001_init.sql")
    _run("002_link_previews.sql")


def downgrade() -> None:
    # Forward-only. Dropping the whole schema is not something a migration should offer.
    raise NotImplementedError("The baseline revision cannot be reversed.")
