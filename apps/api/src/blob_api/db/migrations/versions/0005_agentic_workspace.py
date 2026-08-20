"""Agentic workspace: thread summaries and human/agent task orchestration.

Revision ID: 0005
Revises: 0004
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid() -> postgresql.UUID[str]:
    return postgresql.UUID(as_uuid=False)


def _now() -> sa.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "thread_summaries",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            _uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id",
            _uuid(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "thread_root_id",
            _uuid(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            _uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column("provider", sa.Text, nullable=False, server_default=sa.text("'heuristic-v1'")),
        sa.Column("overview", sa.Text, nullable=False),
        sa.Column(
            "decisions",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "action_items",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "open_questions",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "participant_ids",
            postgresql.ARRAY(_uuid()),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column("message_count", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.UniqueConstraint("thread_root_id", name="thread_summaries_root_uniq"),
    )
    op.create_index(
        "thread_summaries_workspace_recent",
        "thread_summaries",
        ["workspace_id", sa.text("updated_at DESC")],
    )

    op.create_table(
        "agent_tasks",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            _uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "channel_id",
            _uuid(),
            sa.ForeignKey("channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "thread_root_id",
            _uuid(),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
        ),
        sa.Column(
            "created_by",
            _uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "assignee_user_id",
            _uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "summary_id",
            _uuid(),
            sa.ForeignKey("thread_summaries.id", ondelete="SET NULL"),
        ),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("instructions", sa.Text, nullable=False, server_default=sa.text("''")),
        sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'todo'")),
        sa.Column("priority", sa.Text, nullable=False, server_default=sa.text("'medium'")),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("outcome", sa.Text),
        sa.Column(
            "external_ref",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.CheckConstraint(
            "status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')",
            name="agent_tasks_status_check",
        ),
        sa.CheckConstraint(
            "priority IN ('low', 'medium', 'high', 'critical')",
            name="agent_tasks_priority_check",
        ),
    )
    op.create_index(
        "agent_tasks_assignee_recent",
        "agent_tasks",
        ["assignee_user_id", sa.text("updated_at DESC")],
        postgresql_where=sa.text("assignee_user_id IS NOT NULL"),
    )
    op.create_index(
        "agent_tasks_workspace_recent",
        "agent_tasks",
        ["workspace_id", sa.text("updated_at DESC")],
    )
    op.create_index(
        "agent_tasks_thread_recent",
        "agent_tasks",
        ["thread_root_id", sa.text("updated_at DESC")],
        postgresql_where=sa.text("thread_root_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("agent_tasks_thread_recent", table_name="agent_tasks")
    op.drop_index("agent_tasks_workspace_recent", table_name="agent_tasks")
    op.drop_index("agent_tasks_assignee_recent", table_name="agent_tasks")
    op.drop_table("agent_tasks")
    op.drop_index("thread_summaries_workspace_recent", table_name="thread_summaries")
    op.drop_table("thread_summaries")
