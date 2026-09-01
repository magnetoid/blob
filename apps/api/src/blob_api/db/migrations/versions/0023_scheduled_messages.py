"""Messages written now and sent later.

Slack's "Schedule message", and the one composer affordance Blob had no answer for: a
reply written at midnight that should not wake anybody, an announcement that belongs at
nine. Blob already had the machinery — a worker sweeping a due-index every minute, the
same shape `saved_items.remind_at` uses — and only lacked the table to sweep.

The row carries the whole message rather than pointing at a draft: a draft lives in the
author's browser, and a message that only exists in one browser cannot be sent by a
worker. `client_msg_id` is carried too, so the eventual send goes through the same
idempotency the live path uses and a retried sweep cannot post twice.

Revision ID: 0023
Revises: 0022
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scheduled_messages",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "thread_root_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("client_msg_id", sa.Text(), nullable=False),
        sa.Column("send_at", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("sent_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("sent_message_id", sa.Text(), nullable=True),
        sa.Column("canceled_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
    )
    # What the sweep asks for every minute: due, not already sent, not cancelled. Partial,
    # because the table is mostly history once a message has gone out and history is not
    # what the sweep is looking for.
    op.create_index(
        "scheduled_messages_due",
        "scheduled_messages",
        ["send_at"],
        postgresql_where=sa.text("sent_at IS NULL AND canceled_at IS NULL"),
    )
    # What the author's own list asks for.
    op.create_index(
        "scheduled_messages_by_author",
        "scheduled_messages",
        ["author_id", "send_at"],
        postgresql_where=sa.text("sent_at IS NULL AND canceled_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("scheduled_messages_by_author", table_name="scheduled_messages")
    op.drop_index("scheduled_messages_due", table_name="scheduled_messages")
    op.drop_table("scheduled_messages")
