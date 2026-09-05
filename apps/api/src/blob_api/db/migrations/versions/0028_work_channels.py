"""A channel spun from a conversation for one assignment, with the things made in it.

A thread is where a piece of work gets *decided*; it is a poor place for the work itself.
An agent asked to build something answers with a wall of text, its diffs scroll past, and
a preview has nowhere to live. Slack shipped "Slack Code" for exactly this in August 2026:
a channel created from a conversation, carrying the context forward, where people and
agents work on one assignment and the agents publish artifacts the team reviews in tabs.

`work_items` is that assignment. It points at the private channel it lives in (one per
channel), at the message it was started from — so the channel can say where it came from
and the source can link forward — and at who started it. `status` is `open` or `done`; a
finished assignment archives its channel, which is what makes the channel list stay a
list of things still happening.

`work_artifacts` is what gets made: a unified diff, a self-contained HTML page, or a
markdown document. Agents publish them over AG-UI (`CUSTOM` events named
`blob.artifact`) or through the bot API; people publish them by hand. Bodies are text,
capped at 200 KiB by the service — an artifact is something to review, not a repository.

Revision ID: 0028
Revises: 0027
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

_UUID = sa.dialects.postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "work_items",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        #: The channel the work lives in. One assignment per channel.
        sa.Column(
            "channel_id",
            _UUID,
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        #: Where it was started from. SET NULL: deleting the message must not delete the work.
        sa.Column(
            "root_message_id",
            _UUID,
            sa.ForeignKey("messages.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "root_channel_id",
            _UUID,
            sa.ForeignKey("channels.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default=sa.text("'open'")),
        sa.Column(
            "created_by", _UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("done_by", _UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("status IN ('open', 'done')", name="work_items_status_check"),
    )
    op.create_index("work_items_workspace", "work_items", ["workspace_id", "created_at"])

    op.create_table(
        "work_artifacts",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "work_id", _UUID, sa.ForeignKey("work_items.id", ondelete="CASCADE"), nullable=False
        ),
        #: The run that published it, when an agent did. SET NULL: runs are swept after 30 days.
        sa.Column(
            "run_id", _UUID, sa.ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        #: A person or a bot: both are users rows (ADR 0005).
        sa.Column(
            "author_user_id", _UUID, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(
            "kind IN ('diff', 'html', 'markdown')", name="work_artifacts_kind_check"
        ),
    )
    op.create_index("work_artifacts_by_work", "work_artifacts", ["work_id", "created_at"])


def downgrade() -> None:
    op.drop_index("work_artifacts_by_work", table_name="work_artifacts")
    op.drop_table("work_artifacts")
    op.drop_index("work_items_workspace", table_name="work_items")
    op.drop_table("work_items")
