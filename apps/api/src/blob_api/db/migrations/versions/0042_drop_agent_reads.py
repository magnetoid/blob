"""Drop the agent-reads bound.

ADR 0017 bounded what the agent Blob ran itself could *read* on the asker's authority
when it answered in a room. That agent is retired (0041) and no other agent runs tools
on the asker's authority — every external agent reads through its own bot token, bounded
by its channel membership and scopes. A switch that changes nothing is worse than no
switch. The reasoning stays in the ADR, superseded, for the day an external agent is
offered Blob's tools.

Revision ID: 0042
Revises: 0041
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("workspace_policies_agent_reads_check", "workspace_policies", type_="check")
    op.drop_column("workspace_policies", "agent_reads")


def downgrade() -> None:
    op.add_column(
        "workspace_policies",
        sa.Column("agent_reads", sa.Text(), nullable=False, server_default="audience"),
    )
    op.create_check_constraint(
        "workspace_policies_agent_reads_check",
        "workspace_policies",
        "agent_reads IN ('audience', 'asker')",
    )
