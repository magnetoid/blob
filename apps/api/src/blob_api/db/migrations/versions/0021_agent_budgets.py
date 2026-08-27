"""An agent can be given a daily budget, and a mention it was refused leaves a row.

Revision ID: 0021
Revises: 0020
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plugins", sa.Column("budget_runs_per_day", sa.Integer(), nullable=True))
    op.add_column("plugins", sa.Column("budget_seconds_per_day", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "plugins_budget_runs_positive",
        "plugins",
        "budget_runs_per_day IS NULL OR budget_runs_per_day > 0",
    )
    op.create_check_constraint(
        "plugins_budget_seconds_positive",
        "plugins",
        "budget_seconds_per_day IS NULL OR budget_seconds_per_day > 0",
    )
    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_status_check",
        "agent_runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled', 'refused')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM agent_runs WHERE status = 'refused'")
    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_status_check",
        "agent_runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled')",
    )
    op.drop_constraint("plugins_budget_seconds_positive", "plugins", type_="check")
    op.drop_constraint("plugins_budget_runs_positive", "plugins", type_="check")
    op.drop_column("plugins", "budget_seconds_per_day")
    op.drop_column("plugins", "budget_runs_per_day")
