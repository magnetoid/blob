"""Meetups become calls: a kind, one live call of each kind per conversation, who is in one.

A meetup was a row and a LiveKit room, and nothing ever ended one — every meetup started
since 0035 is still `active`, with no room behind it. Calls end: LiveKit's webhooks say
when a room closed, and a sweep asks LiveKit once a minute (services/calls.py). The rows
already stranded are ended here, because nothing else ever would.

`call_participants` holds a person only while they are connected, and ending a call
deletes its rows: Blob keeps no attendance history. `sid` is LiveKit's id for one
connection, so a "left" that arrives after a rejoin cannot remove the new connection.

Revision ID: 0045
Revises: 0044
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("meetups", "calls")
    op.execute("ALTER INDEX meetups_pkey RENAME TO calls_pkey")
    op.execute("ALTER INDEX meetups_channel RENAME TO calls_channel")
    op.execute("ALTER INDEX meetups_workspace_recent RENAME TO calls_workspace_recent")
    op.execute("ALTER TABLE calls RENAME CONSTRAINT meetups_status_check TO calls_status_check")
    # RENAME TABLE renames the relation and nothing else: a foreign key keeps the name
    # Postgres gave it when `meetups` was created, and `alembic check` compares foreign
    # keys by signature rather than by name, so a stale `meetups_*` name stays quiet.
    op.execute(
        "ALTER TABLE calls RENAME CONSTRAINT meetups_channel_id_fkey TO calls_channel_id_fkey"
    )
    op.execute(
        "ALTER TABLE calls RENAME CONSTRAINT meetups_created_by_fkey TO calls_created_by_fkey"
    )
    op.execute(
        "ALTER TABLE calls RENAME CONSTRAINT meetups_workspace_id_fkey TO calls_workspace_id_fkey"
    )

    op.add_column(
        "calls", sa.Column("kind", sa.Text(), server_default=sa.text("'meetup'"), nullable=False)
    )
    op.create_check_constraint("calls_kind_check", "calls", "kind IN ('huddle', 'meetup')")

    op.execute("UPDATE calls SET status = 'ended', ended_at = now() WHERE status = 'active'")
    op.create_index(
        "calls_one_live",
        "calls",
        ["channel_id", "kind"],
        unique=True,
        postgresql_where=sa.text("status = 'active'"),
    )

    op.create_table(
        "call_participants",
        sa.Column("call_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=False), nullable=False),
        sa.Column("sid", sa.Text(), nullable=False),
        sa.Column(
            "joined_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["call_id"], ["calls.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("call_id", "user_id"),
    )


def downgrade() -> None:
    op.drop_table("call_participants")
    op.drop_index(
        "calls_one_live", table_name="calls", postgresql_where=sa.text("status = 'active'")
    )
    op.drop_constraint("calls_kind_check", "calls", type_="check")
    op.drop_column("calls", "kind")
    op.execute(
        "ALTER TABLE calls RENAME CONSTRAINT calls_workspace_id_fkey TO meetups_workspace_id_fkey"
    )
    op.execute(
        "ALTER TABLE calls RENAME CONSTRAINT calls_created_by_fkey TO meetups_created_by_fkey"
    )
    op.execute(
        "ALTER TABLE calls RENAME CONSTRAINT calls_channel_id_fkey TO meetups_channel_id_fkey"
    )
    op.execute("ALTER TABLE calls RENAME CONSTRAINT calls_status_check TO meetups_status_check")
    op.execute("ALTER INDEX calls_workspace_recent RENAME TO meetups_workspace_recent")
    op.execute("ALTER INDEX calls_channel RENAME TO meetups_channel")
    op.execute("ALTER INDEX calls_pkey RENAME TO meetups_pkey")
    op.rename_table("calls", "meetups")
