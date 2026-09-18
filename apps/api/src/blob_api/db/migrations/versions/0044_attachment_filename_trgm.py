"""A filename is searchable.

⌘K gains a Files section, which asks `attachments.filename ILIKE '%term%'` — a pattern
with a leading wildcard, which no b-tree can answer. `pg_trgm` has been installed since
0032 (it is what lets three letters of `šta` find a message), so this is an index and not
an extension.

The opclass goes on the column rather than on an expression. pg_trgm folds case itself,
so `ILIKE` uses this index unchanged and no `lower()` wrapper is needed; and a plain
column index reflects as a column index, which is what keeps `alembic check` quiet
against the mirror in `db/models.py`.

Filenames are not accent-folded. Message bodies are, through the generated `search_tsv`
and `blob_unaccent`, but that fold is a stored column with its own index; a filename has
neither, and adding one is a bigger change than this slice.

Revision ID: 0044
Revises: 0043
"""

from __future__ import annotations

from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS attachments_filename_trgm
            ON attachments USING gin (filename gin_trgm_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS attachments_filename_trgm")
