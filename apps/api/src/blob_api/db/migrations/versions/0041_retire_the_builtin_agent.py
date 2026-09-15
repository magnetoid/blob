"""Retire the agent Blob ran itself.

Decided 2026-09-15: Janus is the agent Blob ships with, and the built-in one — a
placeholder for exactly that — goes. Its rows are retired the way `registry.uninstall`
retires any app, statement for statement: the bot deactivated with `bot_plugin_id`
cleared, its address mangled so the identity is free (`users_workspace_id_email_key`),
its handle released so the name can be claimed, and the plugin row deleted — grants,
secrets, tokens and queued deliveries cascade. Every message it ever sent stays, under a
retired author, like any uninstalled app's.

Then `plugins_runtime_check` is tightened to the runtimes that remain. `agent_runs`
keeps `'builtin'` in its transport check: the run log is history and the rows stay.

Revision ID: 0041
Revises: 0040
"""

from __future__ import annotations

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TEMP TABLE retiring AS
            SELECT u.id AS user_id, p.id AS plugin_id
              FROM users u JOIN plugins p ON p.id = u.bot_plugin_id
             WHERE p.runtime = 'builtin'
        """
    )
    op.execute(
        """
        UPDATE users
           SET deactivated_at = now(),
               bot_plugin_id = NULL,
               email = split_part(email, '@', 1) || '+' || id::text
                       || '@' || split_part(email, '@', 2)
         WHERE id IN (SELECT user_id FROM retiring)
        """
    )
    op.execute("DELETE FROM workspace_handles WHERE user_id IN (SELECT user_id FROM retiring)")
    op.execute("DELETE FROM plugins WHERE runtime = 'builtin'")
    op.execute("DROP TABLE retiring")
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket')",
    )


def downgrade() -> None:
    # The rows cannot be brought back; only the runtime becomes admissible again.
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket', 'builtin')",
    )
