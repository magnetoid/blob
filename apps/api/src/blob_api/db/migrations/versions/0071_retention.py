"""Retention and legal hold (M3 · B4, ADR 0039): a workspace may remove messages and files
past a line it chooses, and a conversation or a person on legal hold is skipped.

* `channels.legal_hold_at` / `legal_hold_by` — a conversation on hold, and who put it there.
* `users.legal_hold_at` / `legal_hold_by` — a person on hold: everything they wrote, and
  every conversation they are in.
* `messages.files_removed` — how many files retention took from a message that kept its
  words, so a reader sees that something was there.
* A conversation whose newest message is a deleted one nobody replied to points at the
  newest message history still shows, as it will from now on.

The windows themselves are keys in `workspace_settings`, like every other setting.

Revision ID: 0071
Revises: 0070
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    for table in ("channels", "users"):
        op.add_column(table, sa.Column("legal_hold_at", sa.DateTime(timezone=True)))
        op.add_column(
            table,
            sa.Column("legal_hold_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        )
    # A constant default: Postgres 11+ adds it without rewriting the table.
    op.add_column(
        "messages",
        sa.Column("files_removed", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    # History stops returning a deleted message nobody replied to, and a conversation's
    # pointer names the newest message history returns — the client compares the last row
    # it loaded with it. A pointer left naming a message deleted before this release would
    # never match again, so it moves back once, here.
    op.execute(
        """
        UPDATE channels c
           SET last_message_id = (
                 SELECT m.id FROM messages m
                  WHERE m.channel_id = c.id
                    AND (m.thread_root_id IS NULL OR m.also_in_channel)
                    AND (m.deleted_at IS NULL OR m.reply_count > 0)
                  ORDER BY m.id DESC
                  LIMIT 1)
         WHERE EXISTS (SELECT 1 FROM messages d
                        WHERE d.id = c.last_message_id
                          AND d.deleted_at IS NOT NULL
                          AND d.reply_count = 0)
        """
    )


def downgrade() -> None:
    op.drop_column("messages", "files_removed")
    for table in ("users", "channels"):
        op.drop_column(table, "legal_hold_by")
        op.drop_column(table, "legal_hold_at")
