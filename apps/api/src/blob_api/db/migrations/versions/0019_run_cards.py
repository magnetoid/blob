"""Live run cards, and a stop button.

The card is the folded view of a run's AG-UI events — plan steps, tool calls,
activity — broadcast live while the run streams and kept here so a reload shows the
same card. `cancelled` joins the status vocabulary because a person can now end a
run instead of watching it spend.

Revision ID: 0019
Revises: 0018
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("card", JSONB(), nullable=True))
    op.add_column(
        "agent_runs", sa.Column("cancel_requested_at", sa.TIMESTAMP(timezone=True), nullable=True)
    )
    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_status_check",
        "agent_runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled')",
    )


def downgrade() -> None:
    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_status_check",
        "agent_runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted')",
    )
    op.drop_column("agent_runs", "cancel_requested_at")
    op.drop_column("agent_runs", "card")
