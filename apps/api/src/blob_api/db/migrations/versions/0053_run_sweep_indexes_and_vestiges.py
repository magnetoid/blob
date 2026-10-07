"""What the run sweep needs, and what was never built (agentic review, phase 8).

- `agent_runs_parent` and `work_artifacts_run`: the indexes behind two foreign keys into
  `agent_runs`. The nightly sweep deletes a month-old run, and Postgres then looks, for
  every run it deleted, for runs naming it as their parent and artifacts it published —
  a sequential scan each, without these. Measured on 40,000 runs: removing 8,000 took
  56 seconds, inside one transaction, and takes 0.3 with them.
- `agent_runs_transport_check` loses `builtin`: migration 0041 deleted every run that
  carried it, together with the agent that made them.
- `plugins_runtime_check` loses `local`. The in-process runtime ADR 0009 described was
  never built: the install route refused it, a person's own agent is always `socket`, and
  `registry.update` never writes a runtime, so no row can hold it. One put there by hand
  stops this migration with a sentence saying what to do, rather than a constraint error.

Revision ID: 0053
Revises: 0052
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade() -> None:
    stray = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM plugins WHERE runtime = 'local'"))
        .scalar_one()
    )
    if stray:
        raise RuntimeError(
            f"{stray} app(s) have runtime 'local', which nothing in Blob creates or loads. "
            "Uninstall them, or set their runtime to 'external', and migrate again."
        )
    op.create_index(
        "agent_runs_parent",
        "agent_runs",
        ["parent_run_id"],
        postgresql_where=sa.text("parent_run_id IS NOT NULL"),
    )
    op.create_index(
        "work_artifacts_run",
        "work_artifacts",
        ["run_id"],
        postgresql_where=sa.text("run_id IS NOT NULL"),
    )
    op.drop_constraint("agent_runs_transport_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_transport_check", "agent_runs", "transport IN ('http', 'socket')"
    )
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check", "plugins", "runtime IN ('external', 'container', 'socket')"
    )


def downgrade() -> None:
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket')",
    )
    op.drop_constraint("agent_runs_transport_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_transport_check",
        "agent_runs",
        "transport IN ('http', 'socket', 'builtin')",
    )
    op.drop_index("work_artifacts_run", table_name="work_artifacts")
    op.drop_index("agent_runs_parent", table_name="agent_runs")
