"""Feedback tickets: bug reports, feature requests and general feedback.

A ticket carries what the reporter typed plus what the browser knew at the time — the
console log and a snapshot of the page — because the diagnostics are the difference
between a report an admin can act on and one they have to chase.

Revision ID: 0007
Revises: 0006
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid() -> postgresql.UUID[str]:
    return postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "feedback_tickets",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            _uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # A ticket outlives the person who filed it: deactivating someone must not erase
        # the bug they reported, so this is SET NULL rather than CASCADE.
        sa.Column(
            "reporter_id",
            _uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        # What the browser knew: the route, the agent, the viewport.
        sa.Column(
            "environment",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("console_log", sa.Text(), nullable=False, server_default=""),
        # The snapshot lives in object storage, not in this row: it is markup measured in
        # hundreds of kilobytes, and it is read once when someone opens the ticket.
        sa.Column("snapshot_key", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "resolved_by",
            _uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint("kind IN ('bug', 'feedback', 'feature')", name="feedback_kind_valid"),
        sa.CheckConstraint("status IN ('open', 'closed')", name="feedback_status_valid"),
    )

    # The console lists newest first, and filters to what is still open.
    op.create_index(
        "feedback_tickets_recent",
        "feedback_tickets",
        ["workspace_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "feedback_tickets_open",
        "feedback_tickets",
        ["workspace_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("status = 'open'"),
    )


def downgrade() -> None:
    op.drop_index("feedback_tickets_open", table_name="feedback_tickets")
    op.drop_index("feedback_tickets_recent", table_name="feedback_tickets")
    op.drop_table("feedback_tickets")
