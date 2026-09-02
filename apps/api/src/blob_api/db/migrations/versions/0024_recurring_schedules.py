"""A scheduled message that comes back.

The standup reminder, which is the workflow every Slack workspace actually has. Blob
already sent a message at a time; this lets the row survive its own send and name the
next one.

Three columns, and each is here for a reason the alternative gets wrong.

`repeat` is a rule, not a list of future rows. Materialising the next hundred occurrences
means editing a hundred rows to change the wording, and deciding what "the next hundred"
means for something with no end.

`timezone` is the author's, stored, because "every weekday at nine" is a statement about
a wall clock and not about UTC. A recurrence computed once in UTC drifts by an hour twice
a year, and the drift is silent — the standup reminder simply starts arriving at eight.
The zone has to be re-read at each occurrence, so it has to be kept.

`last_sent_at` exists because a recurring row never sets `sent_at`: that column is what
takes a row out of the sweep's partial index, and a recurrence is never finished. The two
answer different questions — "is this done" and "when did it last go out" — and one column
cannot answer both.

Revision ID: 0024
Revises: 0023
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable, so every existing row keeps meaning exactly what it meant: send once.
    op.add_column("scheduled_messages", sa.Column("repeat", sa.Text(), nullable=True))
    op.add_column(
        "scheduled_messages",
        sa.Column("timezone", sa.Text(), nullable=False, server_default="UTC"),
    )
    op.add_column(
        "scheduled_messages",
        sa.Column("last_sent_at", sa.TIMESTAMP(timezone=True), nullable=True),
    )
    # The vocabulary lives in the database as well as in the code, because a bad value
    # here is a row the sweep picks up every minute and cannot act on.
    op.create_check_constraint(
        "scheduled_messages_repeat_known",
        "scheduled_messages",
        "repeat IS NULL OR repeat IN ('daily', 'weekdays', 'weekly')",
    )


def downgrade() -> None:
    op.drop_constraint("scheduled_messages_repeat_known", "scheduled_messages")
    op.drop_column("scheduled_messages", "last_sent_at")
    op.drop_column("scheduled_messages", "timezone")
    op.drop_column("scheduled_messages", "repeat")
