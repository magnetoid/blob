"""Admin console: audit log, workspace settings, invite roles.

Revision ID: 0002
Revises: 0001
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        # 'user.role_changed', 'channel.archived', 'plugin.installed', …
        sa.Column("action", sa.Text, nullable=False),
        sa.Column("target_type", sa.Text),
        sa.Column("target_id", postgresql.UUID(as_uuid=False)),
        sa.Column(
            "metadata",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("ip", postgresql.INET),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # UUIDv7 ids sort chronologically, so "newest first" needs no timestamp index.
    op.create_index("audit_events_recent", "audit_events", ["workspace_id", sa.text("id DESC")])
    op.create_index("audit_events_actor", "audit_events", ["actor_id", sa.text("id DESC")])
    op.create_index("audit_events_action", "audit_events", ["workspace_id", "action"])

    op.create_table(
        "workspace_settings",
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "settings",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_by",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
    )

    # An invite can now carry the role it grants, so admins can invite admins.
    op.add_column(
        "invites",
        sa.Column("role", sa.Text, nullable=False, server_default=sa.text("'member'")),
    )
    op.add_column("invites", sa.Column("revoked_at", sa.DateTime(timezone=True)))
    op.create_check_constraint("invites_role_check", "invites", "role IN ('member', 'admin')")
    op.create_index("invites_workspace", "invites", ["workspace_id", sa.text("id DESC")])


def downgrade() -> None:
    op.drop_index("invites_workspace", table_name="invites")
    op.drop_constraint("invites_role_check", "invites", type_="check")
    op.drop_column("invites", "revoked_at")
    op.drop_column("invites", "role")
    op.drop_table("workspace_settings")
    op.drop_index("audit_events_action", table_name="audit_events")
    op.drop_index("audit_events_actor", table_name="audit_events")
    op.drop_index("audit_events_recent", table_name="audit_events")
    op.drop_table("audit_events")
