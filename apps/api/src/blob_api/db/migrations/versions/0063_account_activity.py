"""What happened to a person's account, and how recently a session proved who it is (M3 · B1).

* `sessions.method` — how the browser holding it signed in (`password`, `passkey`, `sso`,
  `reset`, `signup`), for the devices list. NULL on sessions minted before this.
* `sessions.reauth_at` — when this session last proved who it is: at sign-in, and again
  each time its person confirms before a sensitive action. A workspace switch carries it
  over rather than resetting it, or switching would launder an old session into a fresh
  one. NULL (every session from before this) is simply "not recently".
* `account_events` — the person's own record: sign-ins, confirmations, failed passwords,
  a changed password, sessions ended. Keyed on the address as well as the account,
  because a person is one row per workspace and one password across all of them, so
  their history is too. Kept ninety days.

Revision ID: 0063
Revises: 0062
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)
NOW = sa.text("now()")

KINDS = (
    "kind IN ('signed_in', 'confirmed', 'failed', 'password_changed', "
    "'signed_out_elsewhere', 'session_ended')"
)
METHODS = "method IS NULL OR method IN ('password', 'passkey', 'sso', 'reset', 'signup')"


def upgrade() -> None:
    op.add_column("sessions", sa.Column("method", sa.Text(), nullable=True))
    op.add_column(
        "sessions", sa.Column("reauth_at", postgresql.TIMESTAMP(timezone=True), nullable=True)
    )
    op.create_table(
        "account_events",
        sa.Column("id", UUID, nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("user_id", UUID, nullable=True),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("method", sa.Text(), nullable=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column(
            "created_at", postgresql.TIMESTAMP(timezone=True), server_default=NOW, nullable=False
        ),
        sa.CheckConstraint(KINDS, name="account_events_kind_check"),
        sa.CheckConstraint(METHODS, name="account_events_method_check"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("account_events_person", "account_events", ["email", sa.text("id DESC")])
    op.create_index("account_events_age", "account_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("account_events_age", table_name="account_events")
    op.drop_index("account_events_person", table_name="account_events")
    op.drop_table("account_events")
    op.drop_column("sessions", "reauth_at")
    op.drop_column("sessions", "method")
