"""What happened when an agent was asked something.

A run left no trace. `jobs/agui._record_error` overwrote `plugins.last_error` and that
was the whole record — so the previous failure vanished the moment a second one happened,
and a run that finished cleanly and said nothing was indistinguishable from one that
never started at all. The question people actually ask about an agent, "I mentioned it
and nothing happened, why?", had no answer anywhere in the system.

Four statuses, because the code already produces four outcomes and collapsing them loses
the one an operator can act on: it posted, it finished cleanly and stayed quiet (silence
is a legitimate answer and `_run_one` says so), it failed, or it came back asking for a
decision. `interrupted` is the actionable one.

`trigger_message_id` is SET NULL rather than CASCADE: deleting the message that started a
run must not delete the evidence that it ran. `plugin_id` and `channel_id` cascade,
because a run belongs to an app in a channel and means nothing without either.

Deliberately not stored: the agent's stream. The posts it produced are already messages
with ids, and the events between them are somebody else's server's internals — keeping
them would turn this table into a transcript store, with the retention and privacy
questions that implies, to answer a question the counts already answer.

Revision ID: 0016
Revises: 0015
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

UUID = sa.dialects.postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "plugin_id", UUID, sa.ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "channel_id", UUID, sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("thread_root_id", UUID),
        # SET NULL: deleting the message that started a run must not delete the record
        # that it ran, which is the only thing that can explain a silence afterwards.
        sa.Column(
            "trigger_message_id", UUID, sa.ForeignKey("messages.id", ondelete="SET NULL")
        ),
        sa.Column("trigger_user_id", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("transport", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'running'")),
        sa.Column("error", sa.Text()),
        sa.Column("post_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "started_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("finished_at", sa.TIMESTAMP(timezone=True)),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed', 'interrupted')",
            name="agent_runs_status_check",
        ),
        sa.CheckConstraint(
            "transport IN ('http', 'socket')", name="agent_runs_transport_check"
        ),
    )
    # The console reads one app's runs, newest first. That is the only query here, and
    # both indexes are ordered to serve it without a sort.
    op.create_index(
        "agent_runs_plugin_recent", "agent_runs", ["plugin_id", sa.text("started_at DESC")]
    )
    op.create_index(
        "agent_runs_workspace_recent",
        "agent_runs",
        ["workspace_id", sa.text("started_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("agent_runs_workspace_recent", table_name="agent_runs")
    op.drop_index("agent_runs_plugin_recent", table_name="agent_runs")
    op.drop_table("agent_runs")
