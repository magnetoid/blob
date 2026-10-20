"""Work channels with a lifecycle (M2 · A10): versions, a review thread, verdicts.

* `work_artifacts.version` / `supersedes_id` — publishing an artifact with the title and
  kind of one already in the work makes its next version rather than a second artifact,
  whoever publishes it: a person, an app, or an agent's `blob.artifact` event.
* `work_artifacts.review_root_id` — the message whose thread is where the artifact is
  discussed. Started by the first person to discuss or review it, and carried forward to
  each new version, so the conversation about a change outlives its drafts.
* `work_reviews` — one verdict per person per version: approved, or changes requested
  with a note. A request for changes on an agent's artifact mentions that agent in the
  thread, on the reviewer's authority, so the next version is one message away.

Revision ID: 0061
Revises: 0060
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)
NOW = sa.text("now()")


def upgrade() -> None:
    op.add_column(
        "work_artifacts",
        sa.Column("version", sa.Integer(), server_default=sa.text("1"), nullable=False),
    )
    op.add_column("work_artifacts", sa.Column("supersedes_id", UUID, nullable=True))
    op.add_column("work_artifacts", sa.Column("review_root_id", UUID, nullable=True))
    op.create_foreign_key(
        "work_artifacts_supersedes_id_fkey",
        "work_artifacts",
        "work_artifacts",
        ["supersedes_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "work_artifacts_review_root_id_fkey",
        "work_artifacts",
        "messages",
        ["review_root_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_check_constraint("work_artifacts_version_positive", "work_artifacts", "version > 0")
    op.create_table(
        "work_reviews",
        sa.Column("id", UUID, nullable=False),
        sa.Column("artifact_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("verdict", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.CheckConstraint("verdict IN ('approved', 'changes')", name="work_reviews_verdict_check"),
        sa.ForeignKeyConstraint(["artifact_id"], ["work_artifacts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_id", "user_id", name="work_reviews_once"),
    )


def downgrade() -> None:
    op.drop_table("work_reviews")
    op.drop_constraint("work_artifacts_version_positive", "work_artifacts", type_="check")
    op.drop_constraint("work_artifacts_review_root_id_fkey", "work_artifacts", type_="foreignkey")
    op.drop_constraint("work_artifacts_supersedes_id_fkey", "work_artifacts", type_="foreignkey")
    op.drop_column("work_artifacts", "review_root_id")
    op.drop_column("work_artifacts", "supersedes_id")
    op.drop_column("work_artifacts", "version")
