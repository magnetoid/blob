"""Workspace-scoped activity events.

Mentions and reactions stay derived from messages so mute/leave/delete keep
working at read time. This table is the generic row for those same events
(dual-written at persist) plus later kinds — reminders, recap — that have
nowhere else to live. MT-phase-1 shape from day one: every row names a
workspace and the user it belongs to.

Revision ID: 0034
Revises: 0033
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "activity_events",
        sa.Column(
            "id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            primary_key=True,
        ),
        sa.Column(
            "workspace_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column(
            "actor_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "channel_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
        ),
        sa.Column(
            "message_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
        ),
        sa.Column("emoji", sa.Text()),
        sa.Column(
            "payload",
            sa.dialects.postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "kind IN ('mention', 'reaction', 'reminder', 'recap')",
            name="activity_events_kind_check",
        ),
    )
    op.create_index(
        "activity_events_feed",
        "activity_events",
        ["workspace_id", "user_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    # Two people reacting to one message are two rows; the same person hitting
    # the same emoji twice is not. NULL emoji (mentions) must collide too.
    op.execute(
        """
        CREATE UNIQUE INDEX activity_events_once
            ON activity_events (
                user_id, kind, message_id, actor_id, COALESCE(emoji, '')
            )
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS activity_events_once")
    op.drop_index("activity_events_feed", table_name="activity_events")
    op.drop_table("activity_events")
