"""Agents may answer each other, and a question an agent asks can be answered.

Until now only a person's message started a run — the loop guard, and it was structural:
two agents that mentioned each other could not converse for ever because neither one's
messages was a trigger. That stopped the runaway case by stopping the whole case. Agents
in one workspace could not hand each other anything.

This replaces the guard with a *chain*. A person's message roots one; an agent's reply
that mentions another agent may extend it by one hop, on the person's authority and
inside a depth budget. Every run therefore records where it sits: `chain_id` is the root
trigger message (UUIDv7, so chains sort), `parent_run_id` is the run whose reply caused
this one, `depth` counts hops from the person, and `initiated_by_user_id` is whose
authority a hop runs on — the person at the root, never the agent in the middle.

The second half is the interrupt. An agent that stopped to ask something posted "Needs a
decision" and there was no way to answer it. The run now keeps the question
(`interrupt`), what the agent knew when it asked (`state`, folded from AG-UI snapshots and
deltas), the message carrying the buttons (`decision_message_id`), when it was answered
and when it stops waiting. A decision nobody answers becomes `expired` — a new terminal
status, because "still answerable" and "nobody answered" must not look alike in the log.

`workspace_policies.agent_chain_max_depth` is the knob: 0 is yesterday's behaviour.

Revision ID: 0026
Revises: 0025
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

_UUID = sa.dialects.postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    # ── lineage ──────────────────────────────────────────────────────────────────
    op.add_column("agent_runs", sa.Column("chain_id", _UUID, nullable=True))
    # Every run that exists was rooted by a person, so it is its own chain.
    op.execute("UPDATE agent_runs SET chain_id = COALESCE(trigger_message_id, id)")
    op.alter_column("agent_runs", "chain_id", nullable=False)
    op.add_column(
        "agent_runs",
        sa.Column(
            "parent_run_id",
            _UUID,
            sa.ForeignKey("agent_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "agent_runs",
        sa.Column("depth", sa.Integer(), nullable=False, server_default=sa.text("0")),
    )
    op.add_column(
        "agent_runs",
        sa.Column(
            "initiated_by_user_id",
            _UUID,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.execute("UPDATE agent_runs SET initiated_by_user_id = trigger_user_id")
    op.create_index("agent_runs_chain", "agent_runs", ["chain_id", "started_at"])

    # ── decisions ────────────────────────────────────────────────────────────────
    op.add_column(
        "agent_runs", sa.Column("interrupt", sa.dialects.postgresql.JSONB(), nullable=True)
    )
    op.add_column("agent_runs", sa.Column("state", sa.dialects.postgresql.JSONB(), nullable=True))
    op.add_column(
        "agent_runs",
        sa.Column(
            "decision_message_id",
            _UUID,
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column("agent_runs", sa.Column("answered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("agent_runs", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))
    # The expiry sweep's whole working set: decisions still waiting.
    op.create_index(
        "agent_runs_waiting",
        "agent_runs",
        ["expires_at"],
        postgresql_where=sa.text("status = 'interrupted' AND answered_at IS NULL"),
    )

    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_status_check",
        "agent_runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled', "
        "'refused', 'expired')",
    )

    # ── the knob ─────────────────────────────────────────────────────────────────
    op.add_column(
        "workspace_policies",
        sa.Column(
            "agent_chain_max_depth", sa.Integer(), nullable=False, server_default=sa.text("4")
        ),
    )


def downgrade() -> None:
    op.drop_column("workspace_policies", "agent_chain_max_depth")
    op.execute("UPDATE agent_runs SET status = 'interrupted' WHERE status = 'expired'")
    op.drop_constraint("agent_runs_status_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_status_check",
        "agent_runs",
        "status IN ('running', 'succeeded', 'failed', 'interrupted', 'cancelled', 'refused')",
    )
    op.drop_index("agent_runs_waiting", table_name="agent_runs")
    op.drop_column("agent_runs", "expires_at")
    op.drop_column("agent_runs", "answered_at")
    op.drop_column("agent_runs", "decision_message_id")
    op.drop_column("agent_runs", "state")
    op.drop_column("agent_runs", "interrupt")
    op.drop_index("agent_runs_chain", table_name="agent_runs")
    op.drop_column("agent_runs", "initiated_by_user_id")
    op.drop_column("agent_runs", "depth")
    op.drop_column("agent_runs", "parent_run_id")
    op.drop_column("agent_runs", "chain_id")
