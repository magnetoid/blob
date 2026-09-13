"""Voice messages: what an attachment row needs to be one.

A voice message is an ordinary attachment with a `kind`, a length, the bars the browser
drew while it was recording, and where its transcript stands. The transcript itself is
**not** here: it goes in `messages.body`, because a voice message carries no typed text,
`search_tsv` already indexes the body, and an agent reading a channel already sees it. A
column here would need its own index, its own fold, and a table rewrite to get one.

`kind` defaults to 'file' so every row that exists keeps meaning what it meant, and
`transcript_status` defaults to 'none' — the honest state for a server with no speech
provider configured: nothing pending, nothing failed, nothing promised.

`waveform` is the peaks the recorder sampled, 64-100 small integers, so a reader draws the
bars without downloading the audio first. It is presentation, which is why it is jsonb and
not a table.

Revision ID: 0038
Revises: 0037
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "attachments",
        sa.Column("kind", sa.Text(), nullable=False, server_default="file"),
    )
    op.add_column("attachments", sa.Column("duration_ms", sa.Integer(), nullable=True))
    op.add_column("attachments", sa.Column("waveform", JSONB(), nullable=True))
    op.add_column(
        "attachments",
        sa.Column("transcript_status", sa.Text(), nullable=False, server_default="none"),
    )
    op.add_column("attachments", sa.Column("transcript_provider", sa.Text(), nullable=True))
    op.create_check_constraint("attachments_kind_check", "attachments", "kind IN ('file', 'voice')")
    op.create_check_constraint(
        "attachments_transcript_status_check",
        "attachments",
        "transcript_status IN ('none', 'pending', 'done', 'failed')",
    )


def downgrade() -> None:
    op.drop_constraint("attachments_transcript_status_check", "attachments")
    op.drop_constraint("attachments_kind_check", "attachments")
    op.drop_column("attachments", "transcript_provider")
    op.drop_column("attachments", "transcript_status")
    op.drop_column("attachments", "waveform")
    op.drop_column("attachments", "duration_ms")
    op.drop_column("attachments", "kind")
