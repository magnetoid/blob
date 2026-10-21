"""Single sign-on with OpenID Connect (M3 · B1, ADR 0033).

* `sso_providers` — an identity provider the server's administrator has connected: the
  button it puts on the sign-in page, its issuer and client id, which addresses it may
  link or create accounts for, and the workspace new people from it join.
* `sso_provider_secrets` — the client secret, apart from the row and never returned, the
  way `mcp_server_secrets` keeps an MCP server's header.
* `sso_identities` — who a provider's `sub` is: an address. Matched on the provider and
  the subject, never on the email claim alone; one subject per address per provider.
* `account_events` learns `sso_linked` and `sso_unlinked`.

Revision ID: 0065
Revises: 0064
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)
NOW = sa.text("now()")

KINDS_BEFORE = (
    "kind IN ('signed_in', 'confirmed', 'failed', 'password_changed', "
    "'signed_out_elsewhere', 'session_ended', 'passkey_added', 'passkey_removed', "
    "'two_step_on', 'two_step_off')"
)
KINDS = (
    "kind IN ('signed_in', 'confirmed', 'failed', 'password_changed', "
    "'signed_out_elsewhere', 'session_ended', 'passkey_added', 'passkey_removed', "
    "'two_step_on', 'two_step_off', 'sso_linked', 'sso_unlinked')"
)


def upgrade() -> None:
    op.create_table(
        "sso_providers",
        sa.Column("id", UUID, nullable=False),
        sa.Column("slug", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("issuer", sa.Text(), nullable=False),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column(
            "scopes", sa.Text(), server_default=sa.text("'openid email profile'"), nullable=False
        ),
        sa.Column(
            "allowed_domains",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("link_by_email", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("join_workspace_id", UUID, nullable=True),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_by", UUID, nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.CheckConstraint("slug ~ '^[a-z0-9][a-z0-9-]{1,30}$'", name="sso_providers_slug_check"),
        sa.ForeignKeyConstraint(["join_workspace_id"], ["workspaces.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug", name="sso_providers_slug_key"),
    )
    op.create_table(
        "sso_provider_secrets",
        sa.Column("provider_id", UUID, nullable=False),
        sa.Column("client_secret", sa.Text(), nullable=False),
        sa.Column(
            "updated_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.ForeignKeyConstraint(["provider_id"], ["sso_providers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("provider_id"),
    )
    op.create_table(
        "sso_identities",
        sa.Column("provider_id", UUID, nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.Column("last_used_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["provider_id"], ["sso_providers.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("provider_id", "subject"),
        sa.UniqueConstraint("provider_id", "email", name="sso_identities_provider_email_key"),
    )
    op.create_index("sso_identities_person", "sso_identities", ["email"])
    op.drop_constraint("account_events_kind_check", "account_events", type_="check")
    op.create_check_constraint("account_events_kind_check", "account_events", KINDS)


def downgrade() -> None:
    op.execute("DELETE FROM account_events WHERE kind IN ('sso_linked', 'sso_unlinked')")
    op.drop_constraint("account_events_kind_check", "account_events", type_="check")
    op.create_check_constraint("account_events_kind_check", "account_events", KINDS_BEFORE)
    op.drop_index("sso_identities_person", table_name="sso_identities")
    op.drop_table("sso_identities")
    op.drop_table("sso_provider_secrets")
    op.drop_table("sso_providers")
