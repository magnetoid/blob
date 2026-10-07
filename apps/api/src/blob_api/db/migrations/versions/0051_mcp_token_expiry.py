"""An assistant's token ends.

`mcp_tokens` lived until somebody revoked it — a credential that acts as a person,
forgotten in a config file on a laptop, good for ever. Now each has `expires_at`, chosen
when it is minted (30, 90 or 365 days), and a token past it resolves to nobody.

Tokens minted before this get 90 days from today rather than none: an assistant set up
last month keeps working through a quarter, its person sees the date in Settings, and no
credential is left without an end.

Revision ID: 0051
Revises: 0050
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "mcp_tokens", sa.Column("expires_at", postgresql.TIMESTAMP(timezone=True), nullable=True)
    )
    op.execute(
        "UPDATE mcp_tokens SET expires_at = now() + interval '90 days' WHERE revoked_at IS NULL"
    )


def downgrade() -> None:
    op.drop_column("mcp_tokens", "expires_at")
