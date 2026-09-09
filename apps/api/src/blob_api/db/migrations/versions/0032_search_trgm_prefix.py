"""pg_trgm so a partial token still finds the row.

Full-text search wants whole lexemes. `deplo` does not match `deployed` under english
stemming, and a trailing-token prefix (`deplo:*`) only helps the last word of a
websearch query if we actually ask for it. The trigram index is the other half: an
ILIKE fallback for short queries, which is how `šta` still shows up when someone
types three letters of it.

Stemming stays english (see 0030). This does not rebuild the tsvector.

Revision ID: 0032
Revises: 0031
"""

from __future__ import annotations

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS messages_body_trgm
            ON messages USING gin (blob_unaccent(body) gin_trgm_ops)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS messages_body_trgm")
