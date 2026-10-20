"""Decisions: what a conversation settled, kept where everyone can find it (M2 · A8).

"A thread that reaches a decision leaves a decision behind" is one of Blob's principles,
and until now nothing did: a summary could say what was settled, but only until the next
summary. A decision is a row of its own, rooted in the message it was settled in and in
that message's channel, so it is read under the channel's membership like the message is.

A person records one — from a message, a thread's summary, or `/decision` — and an agent
may only propose one, recorded in the name of the person who approves it (`proposed_by`
keeps which agent asked). Revoked, never deleted. Idempotent on the client's id.

`decisions_message_live` lets the message list mark a message as a decision's source with
one index probe per row, which is how a message carries `decisionId` without a column of
its own to keep in step.

Revision ID: 0057
Revises: 0056
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "decisions",
        sa.Column("id", UUID, nullable=False),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("channel_id", UUID, nullable=False),
        sa.Column("message_id", UUID, nullable=True),
        sa.Column("thread_root_id", UUID, nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("decided_by", UUID, nullable=True),
        sa.Column("proposed_by", UUID, nullable=True),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_by", UUID, nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["thread_root_id"], ["messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["decided_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["proposed_by"], ["plugins.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["revoked_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "client_id", name="decisions_client_uniq"),
    )
    op.create_index(
        "decisions_message_live",
        "decisions",
        ["message_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL AND message_id IS NOT NULL"),
    )
    op.create_index("decisions_channel", "decisions", ["channel_id", sa.text("created_at DESC")])
    op.create_index(
        "decisions_workspace", "decisions", ["workspace_id", sa.text("created_at DESC")]
    )


def downgrade() -> None:
    op.drop_index("decisions_workspace", table_name="decisions")
    op.drop_index("decisions_channel", table_name="decisions")
    op.drop_index("decisions_message_live", table_name="decisions")
    op.drop_table("decisions")
