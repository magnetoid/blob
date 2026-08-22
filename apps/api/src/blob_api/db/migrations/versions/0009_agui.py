"""An app may declare an AG-UI endpoint instead of a webhook.

There is no run table here, and that is the point. A run's identity is
`agui:{trigger message id}:{agui message id}`, written into `client_msg_id`, so the
unique index that already makes every message write idempotent is also the ledger that
stops a re-run posting the same answer twice.

Revision ID: 0009
Revises: 0008
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column("plugins", sa.Column("agui_url", sa.Text(), nullable=True))
    # An external app used to need a webhook URL. One that speaks AG-UI has nothing to
    # declare there — Blob calls it — so either satisfies the constraint now.
    op.drop_constraint("plugins_external_needs_url", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_external_needs_url",
        "plugins",
        "runtime <> 'external' OR request_url IS NOT NULL OR agui_url IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("plugins_external_needs_url", "plugins", type_="check")
    op.drop_column("plugins", "agui_url")
    # This fails if an external app is installed that declared only an AG-UI endpoint,
    # because such a row has no request_url to fall back on. That is the correct
    # outcome and not an oversight: the alternatives are deleting somebody's installed
    # app or quietly rewriting its runtime, and a migration that refuses is easier to
    # recover from than one that did either. Uninstall the app, then downgrade.
    op.create_check_constraint(
        "plugins_external_needs_url",
        "plugins",
        "runtime <> 'external' OR request_url IS NOT NULL",
    )
