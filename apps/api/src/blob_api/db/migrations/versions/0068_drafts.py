"""Drafts that follow you (M3 · B3, ADR 0037): what you typed and have not sent, kept
on the server so the next device you open has it.

`place` is the draft's address as the client writes it — the channel's id, or
"channel:thread-root" for a reply — so a draft is one row per person per place and an
upsert needs no expression index. Gone when its message is sent, its place is gone, or
it has sat for thirty days.

Revision ID: 0068
Revises: 0067
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "drafts",
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("place", sa.Text(), nullable=False),
        sa.Column(
            "channel_id", UUID, sa.ForeignKey("channels.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column(
            "thread_root_id", UUID, sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=True
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("user_id", "place"),
    )
    op.create_index("drafts_updated", "drafts", ["updated_at"])


def downgrade() -> None:
    op.drop_table("drafts")
