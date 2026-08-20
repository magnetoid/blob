"""Cached message translations and user language preferences.

Revision ID: 0006
Revises: 0005
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid() -> postgresql.UUID[str]:
    return postgresql.UUID(as_uuid=False)


def _now() -> sa.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "message_translations",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            _uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "message_id",
            _uuid(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "requested_by",
            _uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("source_body", sa.Text, nullable=False),
        sa.Column("source_language", sa.Text),
        sa.Column("target_language", sa.Text, nullable=False),
        sa.Column("translated_text", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.UniqueConstraint(
            "message_id",
            "target_language",
            name="message_translations_target_uniq",
        ),
    )
    op.create_index("message_translations_message", "message_translations", ["message_id"])
    op.create_index(
        "message_translations_workspace_recent",
        "message_translations",
        ["workspace_id", sa.text("updated_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("message_translations_workspace_recent", table_name="message_translations")
    op.drop_index("message_translations_message", table_name="message_translations")
    op.drop_table("message_translations")
