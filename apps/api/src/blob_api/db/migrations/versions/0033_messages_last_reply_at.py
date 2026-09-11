"""Index thread list by last_reply_at.

GET /api/threads orders by messages.last_reply_at DESC NULLS LAST. Without an
index that is a sort of every subscribed root. The column has been written since
threads shipped; this is the missing half of that query.

Revision ID: 0033
Revises: 0032
"""

from __future__ import annotations

from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS messages_last_reply_at
            ON messages (last_reply_at DESC NULLS LAST)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS messages_last_reply_at")
