"""Someone has to be above the workspaces.

`users.role` tops out at `owner`, and an owner owns *a workspace* — there has never been
anything above that because there has never been more than one workspace to be above.
Gating the instance console on `owner` worked only while "the owner" and "the only owner"
were the same person.

Keyed on email rather than on a user id, and that is the whole design. Under Slack's
model — which this schema already allowed, since `users` is unique on
(workspace_id, email) rather than on email — one person is several user rows, one per
workspace they belong to. An instance admin is the *person*, so the key has to be the
thing that is the same across those rows.

The existing owner is seeded in, so a server that upgrades does not lock its operator out
of a console they were using a minute earlier.

Revision ID: 0011
Revises: 0010
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "instance_admins",
        sa.Column("email", sa.Text(), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    # citext, so an operator who types their address with different capitalisation than
    # they signed up with is still the same person. Matches how `users.email` is stored.
    op.execute("ALTER TABLE instance_admins ALTER COLUMN email TYPE CITEXT")

    # Whoever owns the oldest workspace was, until this migration, the instance admin in
    # everything but name. Keep it that way rather than handing them an empty table and a
    # console they can no longer open.
    op.execute(
        """
        INSERT INTO instance_admins (email)
        SELECT u.email
          FROM users u
          JOIN workspaces w ON w.id = u.workspace_id
         WHERE u.role = 'owner'
           AND u.kind = 'human'
           AND u.deactivated_at IS NULL
           AND w.id = (SELECT id FROM workspaces ORDER BY created_at LIMIT 1)
        ON CONFLICT (email) DO NOTHING
        """
    )


def downgrade() -> None:
    op.drop_table("instance_admins")
