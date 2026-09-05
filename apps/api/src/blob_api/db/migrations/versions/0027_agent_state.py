"""An agent remembers what it knew, per conversation.

Every run was cold: an agent got the last thirty messages and nothing of its own. AG-UI
has carried shared state since before Blob spoke it — `STATE_SNAPSHOT` and `STATE_DELTA`,
which migration 0026 started folding so a question could be resumed with what the agent
knew when it asked. This keeps that fold past the run. The last state an agent left in a
conversation is what it is handed at the start of the next one there.

One row per (agent, conversation), where a conversation is what AG-UI calls the thread:
a channel, or a thread inside one. Replaced whole on every run that shared state; never
appended to, because the agent's snapshot already *is* the whole of what it wants kept.
Capped at the same 64 KiB the fold caps at, so a resume and a memory cost the same.

Revision ID: 0027
Revises: 0026
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None

_UUID = sa.dialects.postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "agent_state",
        sa.Column(
            "plugin_id", _UUID, sa.ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False
        ),
        #: The AG-UI `threadId`: a thread root's id, or the channel's when not in a thread.
        sa.Column("thread_key", _UUID, nullable=False),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", sa.dialects.postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.PrimaryKeyConstraint("plugin_id", "thread_key", name="agent_state_pkey"),
    )


def downgrade() -> None:
    op.drop_table("agent_state")
