"""What a run said, kept for a week; and an app's last ten errors, not its last one.

- `agent_runs.events`: the last 200 raw AG-UI events a run streamed, each cut to a couple
  of kilobytes, written when it ends — what an operator reads when the card and the error
  do not explain a run. Kept seven days: the nightly sweep empties it after that, while
  the run itself is kept for its thirty.
- `plugins.recent_errors`: newest first, at most ten `{at, error}`. `last_error` was one
  string that the next failure overwrote, so an agent failing three ways in an hour showed
  only the last. `last_error` stays, as the newest of them.
- `agent_runs_running`: the runs in flight, by agent, which a `/metrics` scrape counts.
  Partial, so it holds the handful of rows running at any moment and not the month.

Revision ID: 0052
Revises: 0051
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("agent_runs", sa.Column("events", postgresql.JSONB(), nullable=True))
    op.add_column(
        "plugins",
        sa.Column(
            "recent_errors",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )
    op.create_index(
        "agent_runs_running",
        "agent_runs",
        ["plugin_id"],
        postgresql_where=sa.text("status = 'running'"),
    )
    # The one error each app already holds is its first entry.
    op.execute(
        """
        UPDATE plugins
           SET recent_errors = jsonb_build_array(
                 jsonb_build_object('at', updated_at, 'error', last_error))
         WHERE last_error IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_index("agent_runs_running", table_name="agent_runs")
    op.drop_column("plugins", "recent_errors")
    op.drop_column("agent_runs", "events")
