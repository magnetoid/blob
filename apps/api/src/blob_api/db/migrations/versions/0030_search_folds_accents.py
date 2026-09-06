"""Search that finds `šta` when you type `sta`.

The search index was `to_tsvector('english', body)`, which is exact about diacritics: a
workspace writing Serbian, German, French or Turkish only matched what was typed with
the same accents, and half of what people type has none. So a channel full of `šta` and
`zašto` answered nothing to `sta` and `zasto`, and the search looked broken rather than
picky.

`unaccent` folds them, on both sides — the stored index and the query — which is the
only way the two can agree. It arrives through a wrapper because `unaccent(text)` is
STABLE (its dictionary could in principle be reloaded) and a generated column insists on
IMMUTABLE; `blob_unaccent` is the documented way round that, and the consequence of the
lie is a stale index if somebody edits the dictionary file, which nobody does.

Stemming stays English. It is the language these workspaces write code in, and English
suffix stripping does little to other languages' words — whereas dropping to `simple`
would stop `deploys` finding `deployed`, which is the search people run every day.

A generated column's expression cannot be altered, so this drops and re-adds it: the
table is rewritten and the GIN index rebuilt under the same name. Minutes on a large
workspace, seconds on a normal one, and the rows themselves are untouched.

Revision ID: 0030
Revises: 0029
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import TSVECTOR

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

WRAPPER = """
CREATE OR REPLACE FUNCTION blob_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$
"""

FOLDED = "to_tsvector('english', blob_unaccent(body))"
PLAIN = "to_tsvector('english', body)"


def _rebuild(expression: str) -> None:
    op.drop_index("messages_search", table_name="messages")
    op.drop_column("messages", "search_tsv")
    op.add_column(
        "messages",
        sa.Column("search_tsv", TSVECTOR, sa.Computed(expression, persisted=True)),
    )
    op.create_index("messages_search", "messages", ["search_tsv"], postgresql_using="gin")


def upgrade() -> None:
    # Trusted since Postgres 13, so the database owner can install it without a superuser.
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")
    op.execute(WRAPPER)
    _rebuild(FOLDED)


def downgrade() -> None:
    _rebuild(PLAIN)
    op.execute("DROP FUNCTION IF EXISTS blob_unaccent(text)")
    # The extension is left installed: something else may have started using it, and an
    # unused extension costs nothing.
