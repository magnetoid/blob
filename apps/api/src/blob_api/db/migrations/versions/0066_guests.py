"""Guests (M3 · B1, ADR 0034): people who are in a workspace for the channels they were
invited to, and nothing else.

* `users.role` and `invites.role` learn `guest`.
* `invites.channel_ids` — the channels a guest invitation lets its person into. Empty for
  every other invitation, which joins the default channels as before.

Revision ID: 0066
Revises: 0065
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.drop_constraint("users_role_check", "users", type_="check")
    op.create_check_constraint(
        "users_role_check", "users", "role IN ('member', 'admin', 'owner', 'guest')"
    )
    op.drop_constraint("invites_role_check", "invites", type_="check")
    op.create_check_constraint(
        "invites_role_check", "invites", "role IN ('member', 'admin', 'guest')"
    )
    op.add_column(
        "invites",
        sa.Column(
            "channel_ids",
            postgresql.ARRAY(UUID),
            server_default=sa.text("'{}'::uuid[]"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    # A guest becomes a member on the way down: the code that kept them to their channels
    # is gone, and an account that fails the check would stop the downgrade.
    op.execute("UPDATE users SET role = 'member' WHERE role = 'guest'")
    op.execute("UPDATE invites SET revoked_at = now() WHERE role = 'guest' AND revoked_at IS NULL")
    op.execute("UPDATE invites SET role = 'member' WHERE role = 'guest'")
    op.drop_column("invites", "channel_ids")
    op.drop_constraint("invites_role_check", "invites", type_="check")
    op.create_check_constraint("invites_role_check", "invites", "role IN ('member', 'admin')")
    op.drop_constraint("users_role_check", "users", type_="check")
    op.create_check_constraint("users_role_check", "users", "role IN ('member', 'admin', 'owner')")
