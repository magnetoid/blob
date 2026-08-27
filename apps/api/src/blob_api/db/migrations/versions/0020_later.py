"""Saved items grow into Later: states, reminders, snooze.

Slack and Zulip converged on this from opposite philosophies in the same year, which
is as close as the industry gets to calling something table stakes: a saved message
gets a state (in progress / archived / done) and, optionally, a time at which it
should come back and say so.

Revision ID: 0020
Revises: 0019
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "saved_items",
        sa.Column("state", sa.Text(), nullable=False, server_default=sa.text("'in_progress'")),
    )
    op.add_column("saved_items", sa.Column("remind_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("saved_items", sa.Column("note", sa.Text(), nullable=True))
    op.add_column(
        "saved_items", sa.Column("reminded_at", sa.TIMESTAMP(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        "saved_items_state_check",
        "saved_items",
        "state IN ('in_progress', 'archived', 'done')",
    )
    op.create_index(
        "saved_items_due",
        "saved_items",
        ["remind_at"],
        postgresql_where=sa.text("remind_at IS NOT NULL AND reminded_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("saved_items_due", table_name="saved_items")
    op.drop_constraint("saved_items_state_check", "saved_items", type_="check")
    op.drop_column("saved_items", "reminded_at")
    op.drop_column("saved_items", "note")
    op.drop_column("saved_items", "remind_at")
    op.drop_column("saved_items", "state")
