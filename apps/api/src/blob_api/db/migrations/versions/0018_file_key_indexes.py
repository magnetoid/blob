"""Indexes for the object-key lookups behind /api/files/<key>.

Every avatar and every attachment render is a GET against that route, which finds its
row by object key — previously a sequential scan of `attachments`, and on a miss a
second scan over users. The hottest read in the app deserves an index.

Revision ID: 0018
Revises: 0017
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("attachments_object_key", "attachments", ["object_key"])
    op.create_index(
        "users_avatar_key",
        "users",
        ["avatar_key"],
        postgresql_where=sa.text("avatar_key IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("users_avatar_key", table_name="users")
    op.drop_index("attachments_object_key", table_name="attachments")
