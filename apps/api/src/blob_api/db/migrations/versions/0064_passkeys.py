"""Passkeys (M3 · B1, ADR 0032).

* `passkey_owners` — one row per address that has ever added a passkey: the random
  `user_handle` a passkey stores for its person (never the address itself), and whether
  a right password is only half a sign-in for them (`two_step`).
* `passkeys` — the public half of each credential, the address it belongs to, its
  signature counter, and what the person calls it. Keyed on the address like the
  password it stands beside: one person, one set, every workspace.
* `account_events` learns the passkey lines of a person's record, and `two_step` as
  the way a password-and-passkey sign-in was made.

Revision ID: 0064
Revises: 0063
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)
NOW = sa.text("now()")

KINDS_BEFORE = (
    "kind IN ('signed_in', 'confirmed', 'failed', 'password_changed', "
    "'signed_out_elsewhere', 'session_ended')"
)
KINDS = (
    "kind IN ('signed_in', 'confirmed', 'failed', 'password_changed', "
    "'signed_out_elsewhere', 'session_ended', 'passkey_added', 'passkey_removed', "
    "'two_step_on', 'two_step_off')"
)
METHODS_BEFORE = "method IS NULL OR method IN ('password', 'passkey', 'sso', 'reset', 'signup')"
METHODS = (
    "method IS NULL OR method IN ('password', 'passkey', 'sso', 'reset', 'signup', 'two_step')"
)


def upgrade() -> None:
    op.create_table(
        "passkey_owners",
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("user_handle", sa.LargeBinary(), nullable=False),
        sa.Column("two_step", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.PrimaryKeyConstraint("email"),
        sa.UniqueConstraint("user_handle", name="passkey_owners_user_handle_key"),
    )
    op.create_table(
        "passkeys",
        sa.Column("id", UUID, nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("credential_id", sa.LargeBinary(), nullable=False),
        sa.Column("public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "transports",
            postgresql.ARRAY(sa.Text()),
            server_default=sa.text("'{}'::text[]"),
            nullable=False,
        ),
        sa.Column("aaguid", sa.Text(), nullable=True),
        sa.Column("backed_up", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.Column("last_used_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["email"], ["passkey_owners.email"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("credential_id", name="passkeys_credential_id_key"),
    )
    op.create_index("passkeys_person", "passkeys", ["email"])
    op.drop_constraint("account_events_kind_check", "account_events", type_="check")
    op.create_check_constraint("account_events_kind_check", "account_events", KINDS)
    op.drop_constraint("account_events_method_check", "account_events", type_="check")
    op.create_check_constraint("account_events_method_check", "account_events", METHODS)


def downgrade() -> None:
    op.execute(
        "DELETE FROM account_events WHERE kind IN "
        "('passkey_added', 'passkey_removed', 'two_step_on', 'two_step_off') "
        "OR method = 'two_step'"
    )
    op.drop_constraint("account_events_method_check", "account_events", type_="check")
    op.create_check_constraint("account_events_method_check", "account_events", METHODS_BEFORE)
    op.drop_constraint("account_events_kind_check", "account_events", type_="check")
    op.create_check_constraint("account_events_kind_check", "account_events", KINDS_BEFORE)
    op.drop_index("passkeys_person", table_name="passkeys")
    op.drop_table("passkeys")
    op.drop_table("passkey_owners")
