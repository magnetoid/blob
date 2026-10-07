"""What an agent remembers is somebody's: the conversation's, or one person's.

`agent_state` was keyed by (agent, conversation). For the workspace's agent that is right —
the conversation's memory, used by anyone's run in it. For an agent somebody owns it was
wrong: lent out, it handed the borrower whatever it remembered of its owner's work and
wrote over it, so since phase 0 a borrowed run has simply gone without memory. Now an
owned agent's memory is per person: its owner's, and each borrower's own.

- `person_id`, NULL for the conversation's memory, a person for theirs. It cascades: a
  person removed takes their memories with them. A row of an agent somebody owns today is
  its owner's: since phase 0 only the owner's runs wrote one, and left NULL it would read
  as the room's — shown to an admin, and out of the owner's own next run's reach.
- `channel_id`, the conversation's channel, which the row never had: `thread_key` is a
  channel's id or a thread root's, so it could not reference either, and a deleted
  channel left its agents' memories behind for good. Backfilled from whichever the key
  names; a row whose conversation no longer exists is deleted, having nowhere to be read.
- `id`, because the key now has a nullable part and a primary key may not. The key itself
  is a unique index that treats a NULL person as one value (`NULLS NOT DISTINCT`,
  PostgreSQL 15+), so the conversation's memory is still one row.
- An index on `updated_at`, for the retention sweep that now exists.

Revision ID: 0050
Revises: 0049
"""

from __future__ import annotations

import sqlalchemy as sa
import uuid_utils
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0050"
down_revision = "0049"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.add_column("agent_state", sa.Column("id", UUID, nullable=True))
    op.add_column("agent_state", sa.Column("channel_id", UUID, nullable=True))
    op.add_column("agent_state", sa.Column("person_id", UUID, nullable=True))

    op.execute(
        "UPDATE agent_state s SET channel_id = c.id FROM channels c WHERE c.id = s.thread_key"
    )
    op.execute(
        """
        UPDATE agent_state s SET channel_id = m.channel_id
          FROM messages m
         WHERE m.id = s.thread_key AND s.channel_id IS NULL
        """
    )
    op.execute("DELETE FROM agent_state WHERE channel_id IS NULL")
    op.execute(
        """
        UPDATE agent_state s SET person_id = p.owner_user_id
          FROM plugins p
         WHERE p.id = s.plugin_id AND p.owner_user_id IS NOT NULL
        """
    )

    # UUIDv7 like every other id here, made in Python because Postgres 16 cannot.
    bind = op.get_bind()
    keys = bind.execute(sa.text("SELECT plugin_id, thread_key FROM agent_state")).fetchall()
    for key in keys:
        bind.execute(
            sa.text("UPDATE agent_state SET id = :id WHERE plugin_id = :p AND thread_key = :t"),
            {"id": str(uuid_utils.uuid7()), "p": key.plugin_id, "t": key.thread_key},
        )

    op.drop_constraint("agent_state_pkey", "agent_state", type_="primary")
    op.alter_column("agent_state", "id", nullable=False)
    op.alter_column("agent_state", "channel_id", nullable=False)
    op.create_primary_key("agent_state_pkey", "agent_state", ["id"])
    op.create_foreign_key(
        "agent_state_channel_id_fkey",
        "agent_state",
        "channels",
        ["channel_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "agent_state_person_id_fkey",
        "agent_state",
        "users",
        ["person_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "agent_state_key",
        "agent_state",
        ["plugin_id", "thread_key", "person_id"],
        unique=True,
        postgresql_nulls_not_distinct=True,
    )
    op.create_index("agent_state_stale", "agent_state", ["updated_at"])


def downgrade() -> None:
    op.drop_index("agent_state_stale", table_name="agent_state")
    op.drop_index("agent_state_key", table_name="agent_state")
    op.drop_constraint("agent_state_person_id_fkey", "agent_state", type_="foreignkey")
    op.drop_constraint("agent_state_channel_id_fkey", "agent_state", type_="foreignkey")
    op.drop_constraint("agent_state_pkey", "agent_state", type_="primary")
    # A person's memories have no place under the old key, which held one per conversation.
    op.execute("DELETE FROM agent_state WHERE person_id IS NOT NULL")
    op.create_primary_key("agent_state_pkey", "agent_state", ["plugin_id", "thread_key"])
    op.drop_column("agent_state", "person_id")
    op.drop_column("agent_state", "channel_id")
    op.drop_column("agent_state", "id")
