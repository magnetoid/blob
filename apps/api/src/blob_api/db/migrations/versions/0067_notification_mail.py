"""Email when you are away (M3 · B3, ADR 0036): what is waiting to be mailed.

`notification_mail` holds, per person, the messages addressed to them — a DM, a mention,
a reply in a thread they follow — that might go in their next email. A row is written
by the notify job and gone once that email is sent, the message is read, or a day has
passed; nothing here is history.

Revision ID: 0067
Revises: 0066
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "notification_mail",
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "message_id", UUID, sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "queued_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("user_id", "message_id"),
        sa.CheckConstraint(
            "reason IN ('dm', 'mention', 'group', 'thread')",
            name="notification_mail_reason_check",
        ),
    )
    op.create_index("notification_mail_queued", "notification_mail", ["queued_at"])
    op.create_index("notification_mail_message", "notification_mail", ["message_id"])


def downgrade() -> None:
    op.drop_table("notification_mail")
