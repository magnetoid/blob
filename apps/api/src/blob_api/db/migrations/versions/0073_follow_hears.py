"""What an agent following a channel hears (M4, ADR 0026's addendum).

`agent_follows.hears`: `everything` — every message a person posts there, as before, and
what every existing row keeps; `files` — only a message that carries a file; `unanswered` —
only a question nobody has answered within `quiet_minutes`, handed to the agent by a cron
rather than as it is posted.

Revision ID: 0073
Revises: 0072
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_follows",
        sa.Column("hears", sa.Text(), nullable=False, server_default=sa.text("'everything'")),
    )
    op.add_column("agent_follows", sa.Column("quiet_minutes", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "agent_follows_hears_check",
        "agent_follows",
        "hears IN ('everything', 'files', 'unanswered')",
    )
    op.create_check_constraint(
        "agent_follows_quiet_check",
        "agent_follows",
        "(hears = 'unanswered') = (quiet_minutes IS NOT NULL)"
        " AND (quiet_minutes IS NULL OR quiet_minutes BETWEEN 15 AND 1440)",
    )


def downgrade() -> None:
    op.drop_constraint("agent_follows_quiet_check", "agent_follows", type_="check")
    op.drop_constraint("agent_follows_hears_check", "agent_follows", type_="check")
    op.drop_column("agent_follows", "quiet_minutes")
    op.drop_column("agent_follows", "hears")
