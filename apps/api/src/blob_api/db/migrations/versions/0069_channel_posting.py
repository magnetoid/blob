"""Announcement channels (M3 · B3): who may post at the top level of a channel.

`posting` is `everyone` — every channel until now — or `admins`, Slack's announcement
channel, where the workspace's admins post and everybody else replies in threads.

Revision ID: 0069
Revises: 0068
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("posting", sa.Text(), server_default=sa.text("'everyone'"), nullable=False),
    )
    op.create_check_constraint(
        "channels_posting_check", "channels", "posting IN ('everyone', 'admins')"
    )


def downgrade() -> None:
    op.drop_constraint("channels_posting_check", "channels", type_="check")
    op.drop_column("channels", "posting")
