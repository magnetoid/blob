"""What an agent may do in the workspace with Blob's tools (ADR 0022).

`plugins.tool_access` is `none`, `read` or `write`. With `read`, an agent answering a
mention is offered Blob's read tools — list, read and search channels, list people — and
Blob runs every call as the person who asked, inside the room it was asked in. With
`write`, it is also offered `post_message`, and every call to it waits for that person
to approve.

`none` for every row, existing and new: no agent's behaviour changes until an admin
decides, on the agent's page.

Revision ID: 0047
Revises: 0046
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plugins",
        sa.Column("tool_access", sa.Text(), nullable=False, server_default=sa.text("'none'")),
    )
    op.create_check_constraint(
        "plugins_tool_access_check",
        "plugins",
        "tool_access IN ('none', 'read', 'write')",
    )


def downgrade() -> None:
    op.drop_constraint("plugins_tool_access_check", "plugins", type_="check")
    op.drop_column("plugins", "tool_access")
