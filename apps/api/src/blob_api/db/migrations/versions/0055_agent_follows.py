"""Channels an agent follows: it hears people's messages there without a mention (ADR 0026).

One row per (agent, channel), set by an admin on the agent's page. A followed channel
hands the agent each message a person posts there, marked as not addressed to it, so it
can stay quiet unless it has something to add. Removing the row is unfollowing; the
agent's membership of the channel is untouched either way.

`agent_runs.addressed` is false for a run a follow started. Such a run shows no card and
no typing in the room — its messages are what the room sees — and one that said nothing
is left out of every list but the admin's run log. Every existing run was addressed.

Revision ID: 0055
Revises: 0054
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_follows",
        sa.Column("plugin_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("channel_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("workspace_id", postgresql.UUID(as_uuid=False), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=False), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("plugin_id", "channel_id"),
    )
    # Admission asks "who follows this channel" on every message a person posts.
    op.create_index("agent_follows_channel", "agent_follows", ["channel_id"])
    op.add_column(
        "agent_runs",
        sa.Column("addressed", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )


def downgrade() -> None:
    op.drop_column("agent_runs", "addressed")
    op.drop_index("agent_follows_channel", table_name="agent_follows")
    op.drop_table("agent_follows")
