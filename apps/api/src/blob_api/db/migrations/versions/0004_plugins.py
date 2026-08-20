"""Plugins: external apps, their bots, grants and the delivery outbox.

Revision ID: 0004
Revises: 0003
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _uuid() -> postgresql.UUID[str]:
    return postgresql.UUID(as_uuid=False)


def _now() -> sa.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "plugins",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "workspace_id",
            _uuid(),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("slug", sa.Text, nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("description", sa.Text),
        # 'local' runs in this process, 'external' over HTTP. One manifest describes
        # both; the runtime is the only thing that differs.
        sa.Column("runtime", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'enabled'")),
        sa.Column("version", sa.Text, nullable=False, server_default=sa.text("'0.0.0'")),
        # External only: where events are POSTed.
        sa.Column("request_url", sa.Text),
        # Event names this app asked for. Nothing is delivered that is not listed here.
        sa.Column(
            "events", postgresql.ARRAY(sa.Text), nullable=False, server_default=sa.text("'{}'")
        ),
        # Why a plugin is in 'failed' — shown in the console rather than only logged.
        sa.Column("last_error", sa.Text),
        sa.Column("installed_by", _uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.CheckConstraint("runtime IN ('local', 'external')", name="plugins_runtime_check"),
        sa.CheckConstraint(
            "status IN ('enabled', 'disabled', 'needs_review', 'failed')",
            name="plugins_status_check",
        ),
        # An external app without somewhere to deliver to is a configuration error, not
        # a state to carry around and check for at every send.
        sa.CheckConstraint(
            "runtime <> 'external' OR request_url IS NOT NULL",
            name="plugins_external_needs_url",
        ),
        sa.UniqueConstraint("workspace_id", "slug", name="plugins_slug_uniq"),
    )

    # ─── bots are real users ──────────────────────────────────────────────────
    # So messages.author_id stays a valid foreign key and avatars, mentions and member
    # lists work with no frontend changes at all.
    op.add_column(
        "users", sa.Column("kind", sa.Text, nullable=False, server_default=sa.text("'human'"))
    )
    op.add_column(
        "users",
        # SET NULL rather than CASCADE: uninstalling deactivates the bot and keeps its
        # messages attributed. Deleting the user would orphan its whole history.
        sa.Column("bot_plugin_id", _uuid(), sa.ForeignKey("plugins.id", ondelete="SET NULL")),
    )
    op.create_check_constraint("users_kind_check", "users", "kind IN ('human', 'bot')")
    op.create_index(
        "users_bot_plugin",
        "users",
        ["bot_plugin_id"],
        unique=True,
        postgresql_where=sa.text("bot_plugin_id IS NOT NULL"),
    )

    op.create_table(
        "plugin_secrets",
        sa.Column(
            "plugin_id",
            _uuid(),
            sa.ForeignKey("plugins.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Shared with the app at install and shown once; every delivery is signed with it.
        sa.Column("signing_secret", sa.Text, nullable=False),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
    )

    op.create_table(
        "plugin_grants",
        sa.Column(
            "plugin_id", _uuid(), sa.ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("scope", sa.Text, nullable=False),
        sa.Column("granted_by", _uuid(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("granted_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        # One row per scope, so revoking one is a delete rather than rewriting a set.
        sa.PrimaryKeyConstraint("plugin_id", "scope", name="plugin_grants_pkey"),
    )

    op.create_table(
        "bot_tokens",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "plugin_id", _uuid(), sa.ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False
        ),
        # Only the hash is stored: a leaked database does not hand over live tokens.
        sa.Column("token_hash", sa.Text, nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("last_used_at", sa.DateTime(timezone=True)),
        sa.Column("revoked_at", sa.DateTime(timezone=True)),
    )
    op.create_index("bot_tokens_plugin", "bot_tokens", ["plugin_id"])

    # ─── the outbox ───────────────────────────────────────────────────────────
    # Rows are written in the same transaction as the thing they describe, so a
    # delivered event always corresponds to a committed row — and an event is never
    # lost because the process died between commit and HTTP call.
    op.create_table(
        "plugin_deliveries",
        sa.Column("id", _uuid(), primary_key=True),
        sa.Column(
            "plugin_id", _uuid(), sa.ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("event", sa.Text, nullable=False),
        sa.Column("payload", postgresql.JSONB, nullable=False),
        sa.Column("status", sa.Text, nullable=False, server_default=sa.text("'pending'")),
        sa.Column("attempts", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column(
            "next_attempt_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()
        ),
        sa.Column("last_status_code", sa.Integer),
        sa.Column("last_error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("delivered_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('pending', 'delivered', 'failed', 'dead')",
            name="plugin_deliveries_status_check",
        ),
    )
    # The drain query: due work, oldest first. Partial, because delivered rows are the
    # overwhelming majority and none of them are ever scanned for.
    op.create_index(
        "plugin_deliveries_due",
        "plugin_deliveries",
        ["next_attempt_at"],
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_index(
        "plugin_deliveries_plugin", "plugin_deliveries", ["plugin_id", sa.text("id DESC")]
    )

    # ─── what a bot can say ───────────────────────────────────────────────────
    op.add_column(
        "messages",
        sa.Column("plugin_id", _uuid(), sa.ForeignKey("plugins.id", ondelete="SET NULL")),
    )
    # Structured message content. Rendered from milestone 17; `body` stays the plain-text
    # fallback and the search_tsv source either way.
    op.add_column("messages", sa.Column("blocks", postgresql.JSONB))


def downgrade() -> None:
    op.drop_column("messages", "blocks")
    op.drop_column("messages", "plugin_id")
    op.drop_index("plugin_deliveries_plugin", table_name="plugin_deliveries")
    op.drop_index("plugin_deliveries_due", table_name="plugin_deliveries")
    op.drop_table("plugin_deliveries")
    op.drop_index("bot_tokens_plugin", table_name="bot_tokens")
    op.drop_table("bot_tokens")
    op.drop_table("plugin_grants")
    op.drop_table("plugin_secrets")
    op.drop_index("users_bot_plugin", table_name="users")
    op.drop_constraint("users_kind_check", "users", type_="check")
    op.drop_column("users", "bot_plugin_id")
    op.drop_column("users", "kind")
    op.drop_table("plugins")
