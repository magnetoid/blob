"""The conversation a delivery came from (M3 · C3), so the delivery log shows an app's
payload only to an admin who can see that conversation.

`plugin_deliveries.channel_id` — set by `plugins/events.emit`, which always knew it. Rows
from before carry none; the log reads the room out of their payload instead, and the
retention sweep takes them within thirty days.

Revision ID: 0072
Revises: 0071
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.add_column(
        "plugin_deliveries",
        sa.Column("channel_id", UUID, sa.ForeignKey("channels.id", ondelete="SET NULL")),
    )


def downgrade() -> None:
    op.drop_column("plugin_deliveries", "channel_id")
