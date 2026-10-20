"""MCP servers an admin connects, whose tools chosen agents may use (ADR 0027).

Blob is the MCP client here — the other direction from `/api/mcp`, where it is the server
for a person's assistant. Four tables:

* `mcp_servers` — the server: where it is, what it is called, and what it last answered
  with (`era`, `protocol_version`), so a call does not probe it again. `slug` prefixes its
  tools' names as agents see them and never changes once made.
* `mcp_server_secrets` — the header it is called with, kept apart as an app's signing
  secret is, read only where a request is made and never returned.
* `mcp_server_tools` — the tools it listed, checked, in its own order, with the admin's
  `policy` for each: `off`, or when a call waits for the person who asked — `ask` (every
  time), `auto_in_dm` (not in the agent's own DM with them), `auto_everywhere` (never).
  The same three values `plugins.write_approval` has.
* `agent_mcp_servers` — which agents may use which servers.

Nothing existing changes: no agent is offered a tool from a server until an admin connects
one and grants it.

Revision ID: 0056
Revises: 0055
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def _now() -> sa.TextClause:
    return sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "mcp_servers",
        sa.Column("id", UUID, nullable=False),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("era", sa.Text(), nullable=True),
        sa.Column("protocol_version", sa.Text(), nullable=True),
        sa.Column("server_name", sa.Text(), nullable=True),
        sa.Column("server_version", sa.Text(), nullable=True),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("last_error_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "slug", name="mcp_servers_slug_uniq"),
        sa.CheckConstraint("era IN ('modern', 'legacy')", name="mcp_servers_era_check"),
    )
    op.create_index(
        "mcp_servers_name_uniq",
        "mcp_servers",
        ["workspace_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_table(
        "mcp_server_secrets",
        sa.Column("server_id", UUID, nullable=False),
        sa.Column("header_name", sa.Text(), nullable=False),
        sa.Column("header_value", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["server_id"], ["mcp_servers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("server_id"),
    )
    op.create_table(
        "mcp_server_tools",
        sa.Column("server_id", UUID, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=True),
        sa.Column("description", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("input_schema", postgresql.JSONB(), nullable=False),
        sa.Column("read_only", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("policy", sa.Text(), nullable=False, server_default=sa.text("'ask'")),
        sa.ForeignKeyConstraint(["server_id"], ["mcp_servers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("server_id", "name", name="mcp_server_tools_pkey"),
        sa.CheckConstraint(
            "policy IN ('off', 'ask', 'auto_in_dm', 'auto_everywhere')",
            name="mcp_server_tools_policy_check",
        ),
    )
    op.create_table(
        "agent_mcp_servers",
        sa.Column("plugin_id", UUID, nullable=False),
        sa.Column("server_id", UUID, nullable=False),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_now()),
        sa.ForeignKeyConstraint(["plugin_id"], ["plugins.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["server_id"], ["mcp_servers.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("plugin_id", "server_id"),
    )
    # "Who may use this server", asked when its page is drawn and when it is removed.
    op.create_index("agent_mcp_servers_server", "agent_mcp_servers", ["server_id"])


def downgrade() -> None:
    op.drop_index("agent_mcp_servers_server", table_name="agent_mcp_servers")
    op.drop_table("agent_mcp_servers")
    op.drop_table("mcp_server_tools")
    op.drop_table("mcp_server_secrets")
    op.drop_index("mcp_servers_name_uniq", table_name="mcp_servers")
    op.drop_table("mcp_servers")
