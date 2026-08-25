"""Messages somebody put aside to come back to.

Slack calls it Later, and it is the one personal-organisation habit this app had no
answer for at all: a message you needed after the meeting could be pinned — which is a
statement to the whole channel — or left to scroll away. Pinning is the channel's
memory; this is yours, and nobody else can see it.

The primary key is (user_id, message_id) rather than a surrogate id, which makes saving
twice a no-op through `ON CONFLICT DO NOTHING` instead of through a check that two
concurrent taps could both pass. That is the same reasoning `plugin_commands` uses to
hold a command name: an index decides, not a read followed by a write.

Both foreign keys cascade. A deleted account takes its list with it, and a message that
is *hard* deleted takes its saves — but messages here are soft-deleted, so every read of
this table still has to exclude `deleted_at IS NOT NULL` itself.

Revision ID: 0014
Revises: 0013
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_items",
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("user_id", "message_id", name="saved_items_pkey"),
    )
    # The list is always "mine, newest first", and it is read on every open of the view.
    op.create_index(
        "saved_items_user_recent",
        "saved_items",
        ["user_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("saved_items_user_recent", table_name="saved_items")
    op.drop_table("saved_items")
