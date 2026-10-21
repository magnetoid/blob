"""Exports (M3 · B4): a workspace's public conversations for its admins, or everything a
person can read for that person, as a zip of JSON lines in object storage.

A row is the request and, once the worker has built it, where the zip is; both go a week
after it was made. Nothing here is the data itself.

Revision ID: 0070
Revises: 0069
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "exports",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("scope", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("object_key", sa.Text()),
        sa.Column("bytes", sa.BigInteger()),
        sa.Column("error", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("scope IN ('workspace', 'personal')", name="exports_scope_check"),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'done', 'failed')", name="exports_status_check"
        ),
    )
    op.create_index("exports_requester", "exports", ["requested_by", "created_at"])
    op.create_index("exports_workspace", "exports", ["workspace_id", "created_at"])


def downgrade() -> None:
    op.drop_table("exports")
