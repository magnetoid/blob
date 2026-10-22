"""Polls (M4, ADR 0041): a poll is a message whose text is the question.

`polls` holds what the question is asked with — two to ten options, whether several may be
chosen, whether who chose what is shown — and `poll_votes` one person's choice of one
option. Both go with their message.

Revision ID: 0074
Revises: 0073
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "polls",
        sa.Column(
            "message_id",
            UUID,
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "workspace_id",
            UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("options", postgresql.JSONB(), nullable=False),
        sa.Column("multiple", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("anonymous", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("closed_at", sa.DateTime(timezone=True)),
        sa.Column("closed_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 10",
            name="polls_options_check",
        ),
    )
    op.create_table(
        "poll_votes",
        sa.Column(
            "message_id",
            UUID,
            sa.ForeignKey("polls.message_id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("option_id", sa.Text(), primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index("poll_votes_user", "poll_votes", ["user_id"])


def downgrade() -> None:
    op.drop_table("poll_votes")
    op.drop_table("polls")
