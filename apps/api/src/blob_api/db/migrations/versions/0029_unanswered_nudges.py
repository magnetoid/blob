"""Unanswered questions: a channel opts in, and each question is nudged at most once.

A question that nobody answers is the one message in a channel that most needs a second
look and the one least likely to get it — it has scrolled away, and the person who asked
it is the only one who still remembers. Slack has no answer to this beyond "remind me";
Gmail's inline nudge ("Sent 3 days ago. Follow up?") is the idiom people know.

`channels.nudge_unanswered` is the switch, per channel and off by default: a nudge acts
on the room's conversation, so it is the room's setting rather than one member's
preference (a member's own opt-out lives in `users.prefs`). `unanswered_nudges` is the
ratchet: one row per question the sweep has acted on, claimed with `INSERT ... ON
CONFLICT DO NOTHING RETURNING`, so two workers cannot nudge the same question twice and a
deleted nudge cannot bring the question back into the sweep. It cascades from the
message, which is also what keeps the test suite's TRUNCATE honest.

Revision ID: 0029
Revises: 0028
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

_UUID = sa.dialects.postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column(
            "nudge_unanswered",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.create_table(
        "unanswered_nudges",
        sa.Column(
            "message_id",
            _UUID,
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id",
            _UUID,
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            _UUID,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "nudged_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "unanswered_nudges_channel",
        "unanswered_nudges",
        ["channel_id", sa.text("nudged_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("unanswered_nudges_channel", table_name="unanswered_nudges")
    op.drop_table("unanswered_nudges")
    op.drop_column("channels", "nudge_unanswered")
