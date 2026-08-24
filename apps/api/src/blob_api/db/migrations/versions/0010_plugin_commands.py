"""An app may provide slash commands.

The unique index on (workspace_id, name) is the whole conflict-resolution story. A check
at install time would pass for both of two apps registering `/deploy` in the same moment
and let the second overwrite the first; an index makes the second INSERT fail, and the
install that loses is told so. The rule is enforced where it cannot be raced rather than
where it is convenient to write.

Deleting an app takes its commands with it. There is nothing to preserve — a command
whose app is gone is a name that answers nothing, and keeping the row would only reserve
it against the next install.

Revision ID: 0010
Revises: 0009
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "plugin_commands",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "plugin_id",
            sa.Uuid(),
            sa.ForeignKey("plugins.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Denormalised from the plugin so the uniqueness rule can be an index. A command
        # name is unique to a workspace, and the constraint has to be able to say so.
        sa.Column(
            "workspace_id",
            sa.Uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("usage", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("workspace_id", "name", name="plugin_commands_name_uniq"),
    )
    # Dispatch reads by plugin when an app is updated or uninstalled.
    op.create_index("plugin_commands_plugin_idx", "plugin_commands", ["plugin_id"])


def downgrade() -> None:
    op.drop_index("plugin_commands_plugin_idx", table_name="plugin_commands")
    op.drop_table("plugin_commands")
