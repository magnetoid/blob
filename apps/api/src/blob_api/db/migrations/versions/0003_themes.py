"""Themes: named token sets an admin can edit.

Revision ID: 0003
Revises: 0002
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "themes",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("mode", sa.Text, nullable=False),
        # Partial overrides on the built-in defaults: { "--accent": "#1f5c3d", … }
        sa.Column(
            "tokens", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        # Presets ship with the app and cannot be deleted, only duplicated.
        sa.Column("is_preset", sa.Boolean, nullable=False, server_default=sa.text("false")),
        sa.Column("is_enabled", sa.Boolean, nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint("mode IN ('light', 'dark')", name="themes_mode_check"),
        sa.UniqueConstraint("workspace_id", "slug", name="themes_slug_uniq"),
    )
    op.create_index("themes_workspace", "themes", ["workspace_id", "mode"])


def downgrade() -> None:
    op.drop_index("themes_workspace", table_name="themes")
    op.drop_table("themes")
