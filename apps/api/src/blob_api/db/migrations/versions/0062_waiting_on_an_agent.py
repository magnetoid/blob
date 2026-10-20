"""A run can wait on another agent without holding a worker (M2 · A2's follow-up).

`ask_agent` used to wait for the other agent's answer inside the asking run's own job,
holding a worker slot for up to three minutes; at most half the slots could wait, and past
that the asking agent was told it could not. Now the run posts its question and ends its
round in a status of its own — `waiting` — and the other agent's finish resumes it, the
way a person's answer resumes a run that asked them. Only the status list changes: what
the resume needs is kept in `interrupt`, as a tool approval's is.

Revision ID: 0062
Revises: 0061
"""

from __future__ import annotations

from alembic import op

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None

_WITH = (
    "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled', "
    "'refused', 'expired', 'waiting')"
)
_WITHOUT = (
    "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled', 'refused', 'expired')"
)


def upgrade() -> None:
    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint("agent_runs_status_check", "agent_runs", _WITH)


def downgrade() -> None:
    # A run still waiting has nobody to resume it once the code that would is gone.
    op.execute(
        "UPDATE agent_runs SET status = 'failed', error = 'that run never heard back', "
        "finished_at = COALESCE(finished_at, now()) WHERE status = 'waiting'"
    )
    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint("agent_runs_status_check", "agent_runs", _WITHOUT)
