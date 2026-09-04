"""An agent can belong to somebody, and be lent to somebody else.

Until now every installed agent was everybody's: any member could mention any of them and
it answered. That is right for the workspace's own assistant and wrong for a personal one
— an assistant that takes instructions from the whole room is not personal.

Two shapes, and the split matters. `plugins.owner_user_id` NULL means the workspace's:
installed by an admin, answering anyone. Set, it means one person's, answering them.
`agent_delegations` is how the owner lends it out — to a named person, optionally in one
channel only, revocably.

Revision ID: 0025
Revises: 0024
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL for everything that exists, which is the correct reading of it: every agent
    # installed before today was installed by an admin for the whole workspace.
    op.add_column(
        "plugins",
        sa.Column(
            "owner_user_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "agent_delegations",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "workspace_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "plugin_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("plugins.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "grantee_user_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "granted_by",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Partial, so the same pair can be granted again after being taken back — a unique
    # index over every row would make a revoked grant block its own replacement.
    op.create_index(
        "agent_delegations_live",
        "agent_delegations",
        ["plugin_id", "grantee_user_id", "channel_id"],
        unique=True,
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_index("agent_delegations_grantee", "agent_delegations", ["grantee_user_id"])


def downgrade() -> None:
    op.drop_index("agent_delegations_grantee", table_name="agent_delegations")
    op.drop_index("agent_delegations_live", table_name="agent_delegations")
    op.drop_table("agent_delegations")
    op.drop_column("plugins", "owner_user_id")
