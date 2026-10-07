"""A task handed to an agent remembers the message that handed it over.

Assigning a task to an agent used to change one column and start nothing: the agent was
never told. Now the assignment posts a hand-off in the task's thread, from the person who
assigned it, mentioning the agent — the same message they would have typed, so it roots a
chain on their authority through the ordinary path. `dispatch_message_id` is that message.
The runs it starts carry it as their chain id, which is how a run that finishes finds the
task it was working on and says how it went.

Revision ID: 0048
Revises: 0047
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_tasks",
        sa.Column(
            "dispatch_message_id",
            postgresql.UUID(as_uuid=False),
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "agent_tasks_dispatch",
        "agent_tasks",
        ["dispatch_message_id"],
        postgresql_where=sa.text("dispatch_message_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("agent_tasks_dispatch", table_name="agent_tasks")
    op.drop_column("agent_tasks", "dispatch_message_id")
