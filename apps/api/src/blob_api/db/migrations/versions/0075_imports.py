"""Imports (ADR 0042): a Slack export brought in as history.

`imports` is one upload and what became of it — read, chosen, run in steps, finished —
with how far it got (`cursor`) committed beside the rows each step wrote. `import_people`
and `import_conversations` say which Blob row each Slack id became, so a later step, and
a second run of the same zip, land on the same ones. `users.placeholder` marks an
account an import made for somebody who has not been invited yet: deactivated, no
password, claimable only through an invitation to its address.

Revision ID: 0075
Revises: 0074
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("placeholder", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_table(
        "imports",
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
        sa.Column("source", sa.Text(), server_default=sa.text("'slack'"), nullable=False),
        sa.Column("status", sa.Text(), server_default=sa.text("'uploading'"), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("bytes", sa.BigInteger()),
        sa.Column("include_private", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("copy_files", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("preview", postgresql.JSONB()),
        sa.Column(
            "progress", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column(
            "cursor", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False
        ),
        sa.Column(
            "problems", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False
        ),
        sa.Column("error", sa.Text()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("source IN ('slack')", name="imports_source_check"),
        sa.CheckConstraint(
            "status IN ('uploading', 'reading', 'ready', 'running', 'done', 'failed', 'cancelled')",
            name="imports_status_check",
        ),
    )
    op.create_index("imports_workspace", "imports", ["workspace_id", sa.text("created_at DESC")])
    # One import runs at a time in a workspace: two would race for the same names.
    op.create_index(
        "imports_one_running",
        "imports",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_table(
        "import_people",
        sa.Column(
            "import_id", UUID, sa.ForeignKey("imports.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("slack_id", sa.Text(), primary_key=True),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        # Made by this import, rather than matched to somebody already here.
        sa.Column("created", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        # A person somebody could invite: not an app, not deleted in Slack, a real address.
        sa.Column("invitable", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.create_table(
        "import_conversations",
        sa.Column(
            "import_id", UUID, sa.ForeignKey("imports.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("slack_id", sa.Text(), primary_key=True),
        sa.Column(
            "channel_id", UUID, sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
        ),
        # Made by this import, rather than merged into a channel already here.
        sa.Column("created", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        # Its place in the order the steps take conversations in.
        sa.Column("position", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("import_conversations")
    op.drop_table("import_people")
    op.drop_table("imports")
    op.drop_column("users", "placeholder")
