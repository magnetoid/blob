"""Kept versions (ADR 0039 addendum): a message's earlier words, kept while it is on hold.

One row is the words a message had before an edit replaced them, written only while the
conversation or its writer is on legal hold — both of which the writer is shown — and
removed when the hold that kept it is released. They go with their message.

Revision ID: 0076
Revises: 0075
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0076"
down_revision = "0075"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "message_versions",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            UUID,
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        # When these words were written — the message's creation or its previous edit.
        sa.Column("written_at", sa.DateTime(timezone=True), nullable=False),
        # When an edit replaced them.
        sa.Column(
            "replaced_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("message_versions_message", "message_versions", ["message_id", "id"])


def downgrade() -> None:
    op.drop_table("message_versions")
