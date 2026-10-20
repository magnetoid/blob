"""Cost you can see (M2 · A9): a token cap per agent, and Blob's own model calls.

* `plugins.budget_tokens_per_day` — a daily cap on the tokens an agent *reports* on its
  runs (AG-UI 1.0 carries them on the last event), beside the run and minute caps Blob
  measures itself. NULL is uncapped.
* `model_calls` — one row per call Blob makes to its own model (the catch-up and thread
  summaries), so the workspace's usage page can show that half of what it spends: who
  asked, which feature, which model, the provider's counts. Nothing of the text.

Revision ID: 0060
Revises: 0059
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)
NOW = sa.text("now()")


def upgrade() -> None:
    op.add_column("plugins", sa.Column("budget_tokens_per_day", sa.BigInteger(), nullable=True))
    op.create_check_constraint(
        "plugins_budget_tokens_positive",
        "plugins",
        "budget_tokens_per_day IS NULL OR budget_tokens_per_day > 0",
    )
    op.create_table(
        "model_calls",
        sa.Column("id", UUID, nullable=False),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("feature", sa.Text(), nullable=False),
        sa.Column("user_id", UUID, nullable=True),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.CheckConstraint("feature IN ('catchup', 'summary')", name="model_calls_feature_check"),
        sa.CheckConstraint(
            "input_tokens >= 0 AND output_tokens >= 0", name="model_calls_tokens_check"
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "model_calls_recent", "model_calls", ["workspace_id", sa.text("created_at DESC")]
    )


def downgrade() -> None:
    op.drop_index("model_calls_recent", table_name="model_calls")
    op.drop_table("model_calls")
    op.drop_constraint("plugins_budget_tokens_positive", "plugins", type_="check")
    op.drop_column("plugins", "budget_tokens_per_day")
