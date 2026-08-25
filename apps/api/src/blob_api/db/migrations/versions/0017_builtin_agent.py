"""Room for the agent Blob runs itself.

Two check constraints widen by one value each. `plugins.runtime` gains `builtin` — an
AG-UI server that never leaves the process — and `agent_runs.transport` gains it too,
because a run that never crossed a network should not be logged as if it did.

Nothing about the built-in agent needs a table of its own. It is a `plugins` row with a
bot in `users`, it holds `plugin_grants` like anything else, and its runs land in
`agent_runs` through the same path an external agent's do. That reuse is the reason this
migration is four statements rather than a schema.

Revision ID: 0017
Revises: 0016
"""

from __future__ import annotations

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket', 'builtin')",
    )
    op.drop_constraint("agent_runs_transport_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_transport_check",
        "agent_runs",
        "transport IN ('http', 'socket', 'builtin')",
    )


def downgrade() -> None:
    # Rows using the new value would fail the narrower constraint. Removing them is the
    # only honest downgrade: keeping a plugin whose runtime the schema forbids would leave
    # a database that cannot be written to.
    op.execute("DELETE FROM agent_runs WHERE transport = 'builtin'")
    op.execute("DELETE FROM plugins WHERE runtime = 'builtin'")
    op.drop_constraint("agent_runs_transport_check", "agent_runs", type_="check")
    op.create_check_constraint(
        "agent_runs_transport_check", "agent_runs", "transport IN ('http', 'socket')"
    )
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket')",
    )
