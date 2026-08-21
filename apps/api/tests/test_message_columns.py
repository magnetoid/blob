"""The message column list has to stay level with the table.

`MESSAGE_SELECT` names its columns instead of using `m.*`, so that reading a message
stops dragging its tsvector along. The cost of naming them is that the list can fall
behind a migration, and the way it fails is quiet: the column simply never reaches the
client, and whichever field depended on it turns up empty for reasons no error explains.

So the list is checked against the database rather than trusted. This is the test the
comment in serialize.py points at.
"""

from __future__ import annotations

import re

from sqlalchemy import text

from blob_api.db.engine import SessionFactory
from blob_api.services.serialize import MESSAGE_COLUMNS

#: Held back on purpose: it is an index, not content, and no serializer reads it.
DELIBERATELY_OMITTED = {"search_tsv"}


def _selected_columns() -> set[str]:
    return set(re.findall(r"\bm\.(\w+)", MESSAGE_COLUMNS))


async def test_the_list_covers_every_column_the_table_has() -> None:
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT column_name FROM information_schema.columns
                     WHERE table_name = 'messages' AND table_schema = 'public'
                    """
                )
            )
        ).fetchall()

    actual = {row.column_name for row in rows}
    assert actual, "no columns found for messages — has the schema been migrated?"

    missing = actual - _selected_columns() - DELIBERATELY_OMITTED
    assert not missing, (
        f"messages has {sorted(missing)}, which MESSAGE_COLUMNS does not select. "
        "Add them there, or add them to DELIBERATELY_OMITTED and say why."
    )


async def test_the_list_does_not_name_columns_that_are_gone() -> None:
    # The other direction: a dropped column left in the list makes every message read
    # fail outright, which is loud, but the failure names SQL rather than this list.
    async with SessionFactory() as session:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT column_name FROM information_schema.columns
                     WHERE table_name = 'messages' AND table_schema = 'public'
                    """
                )
            )
        ).fetchall()

    actual = {row.column_name for row in rows}
    invented = _selected_columns() - actual
    assert not invented, f"MESSAGE_COLUMNS selects {sorted(invented)}, which no longer exist."


async def test_the_tsvector_stays_out_of_message_reads() -> None:
    # The whole reason the list exists. If someone restores `m.*` this is what objects.
    assert "search_tsv" not in _selected_columns()
