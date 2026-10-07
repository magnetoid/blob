"""What an agent was shown, kept on its run.

`agent_runs.seen` is a small JSON object written when the run ends: how many messages of
the conversation it was handed and from which window, how many files, whether the
workspace's instructions, its memory here and a task went with them, which of Blob's tools
it was offered, and which AG-UI it was spoken to in. Counts and names, never content —
the content is the conversation, which is where it already is.

It answers the question every surprising answer raises — "what did it actually see?" —
which until now meant reading the job's code against the run's timestamps. NULL for every
run before this, and for one Blob could not finish recording.

Two indexes page a conversation's runs and an agent's back by id — the run history a
member can now read. There was no index on a run's channel at all; the conversation's
load read through the workspace's.

Revision ID: 0049
Revises: 0048
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("seen", postgresql.JSONB(), nullable=True))
    op.create_index("agent_runs_channel_history", "agent_runs", ["channel_id", "id"])
    op.create_index("agent_runs_plugin_history", "agent_runs", ["plugin_id", "id"])


def downgrade() -> None:
    op.drop_index("agent_runs_plugin_history", table_name="agent_runs")
    op.drop_index("agent_runs_channel_history", table_name="agent_runs")
    op.drop_column("agent_runs", "seen")
