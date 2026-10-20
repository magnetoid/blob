"""OAuth for the MCP endpoint: an assistant connects with a sign-in (ADR 0029).

Until now a person's assistant reached `/api/mcp` with a token they minted in Settings and
pasted somewhere. Claude, ChatGPT and their peers add a connector by URL and expect the
server to send the person through an OAuth 2.1 sign-in instead. Blob is that authorization
server, for its own MCP endpoint only:

* `oauth_clients` — the assistants that may ask: known by the metadata document their
  `client_id` URL serves (`metadata`, Client ID Metadata Documents), or registered through
  RFC 7591 (`registered`, kept for clients that have not moved on).
* `oauth_grants` — a person's yes to one of them, with what it may do: read, or read and
  post. Revoking it ends every token it minted.
* `oauth_refresh_tokens` — the grant's refresh chain, each link used once.
* `mcp_tokens.grant_id` — an access token a grant minted is an ordinary MCP token, an hour
  long, so the endpoint resolves it exactly as it resolves a pasted one: to the person.

Revision ID: 0059
Revises: 0058
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)
NOW = sa.text("now()")


def upgrade() -> None:
    op.create_table(
        "oauth_clients",
        sa.Column("id", UUID, nullable=False),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("client_name", sa.Text(), nullable=False),
        sa.Column("client_uri", sa.Text(), nullable=True),
        sa.Column("redirect_uris", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("client_id"),
        sa.CheckConstraint("kind IN ('registered', 'metadata')", name="oauth_clients_kind_check"),
    )
    op.create_table(
        "oauth_grants",
        sa.Column("id", UUID, nullable=False),
        sa.Column("workspace_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("client_id", UUID, nullable=False),
        sa.Column("scopes", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["oauth_clients.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "scopes <@ ARRAY['read', 'write']::text[] AND 'read' = ANY(scopes)",
            name="oauth_grants_scopes_check",
        ),
    )
    op.create_index(
        "oauth_grants_person",
        "oauth_grants",
        ["user_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.create_table(
        "oauth_refresh_tokens",
        sa.Column("id", UUID, nullable=False),
        sa.Column("grant_id", UUID, nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=NOW),
        sa.ForeignKeyConstraint(["grant_id"], ["oauth_grants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("oauth_refresh_tokens_grant", "oauth_refresh_tokens", ["grant_id"])
    op.add_column("mcp_tokens", sa.Column("grant_id", UUID, nullable=True))
    op.create_foreign_key(
        "mcp_tokens_grant_id_fkey",
        "mcp_tokens",
        "oauth_grants",
        ["grant_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("mcp_tokens_grant_id_fkey", "mcp_tokens", type_="foreignkey")
    op.drop_column("mcp_tokens", "grant_id")
    op.drop_index("oauth_refresh_tokens_grant", table_name="oauth_refresh_tokens")
    op.drop_table("oauth_refresh_tokens")
    op.drop_index("oauth_grants_person", table_name="oauth_grants")
    op.drop_table("oauth_grants")
    op.drop_table("oauth_clients")
