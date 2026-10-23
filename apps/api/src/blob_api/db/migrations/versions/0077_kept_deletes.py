"""Kept deletes (ADR 0039 addendum): a held message's last words, when it is deleted.

`message_versions.ended_by` says what ended a version's words: an edit replaced them, or a
delete took them. A delete under a hold now keeps the words it takes, under the same rule
as an edit — only where the writer is shown the hold — and they go when the hold does.

Revision ID: 0077
Revises: 0076
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0077"
down_revision = "0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "message_versions",
        sa.Column("ended_by", sa.Text(), server_default=sa.text("'edit'"), nullable=False),
    )
    op.create_check_constraint(
        "message_versions_ended_by_check", "message_versions", "ended_by IN ('edit', 'delete')"
    )


def downgrade() -> None:
    op.drop_constraint("message_versions_ended_by_check", "message_versions")
    op.drop_column("message_versions", "ended_by")
