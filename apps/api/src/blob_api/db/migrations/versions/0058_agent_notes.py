"""Notes an agent keeps, in words people can read (M2 · A8).

Beside the AG-UI state blob in `agent_state`, which an agent writes for itself and nobody
can read sensibly, a note is a sentence an agent chose to remember — "Ana wants the summary
on Mondays", "staging is blue-2" — written through Blob's `remember` tool and so something a
person can read, correct and remove.

Keyed exactly as `agent_state` is (ADR 0024): by agent and conversation, with `person_id`
NULL for the workspace's agent — the conversation's notes, an admin's to see in the rooms
they can see — and a person for an agent somebody owns, that person's alone. A deleted
channel, agent or person takes its notes with it; the nightly sweep ends a conversation's
notes ninety days after the last one was written, as it ends a memory.

Revision ID: 0058
Revises: 0057
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "agent_notes",
        sa.Column("id", UUID, nullable=False),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("plugin_id", UUID, nullable=False),
        sa.Column("channel_id", UUID, nullable=False),
        sa.Column("person_id", UUID, nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["person_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "agent_notes_scope",
        "agent_notes",
        ["plugin_id", "channel_id", "person_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "agent_notes_person",
        "agent_notes",
        ["person_id"],
        postgresql_where=sa.text("person_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("agent_notes_person", table_name="agent_notes")
    op.drop_index("agent_notes_scope", table_name="agent_notes")
    op.drop_table("agent_notes")
