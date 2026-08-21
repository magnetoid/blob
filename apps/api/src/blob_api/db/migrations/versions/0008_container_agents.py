"""Agents installed from a repository and hosted as containers.

A container agent is an external app whose hosting Blob arranged — see ADR 0010. The
contract with the workspace does not change, so this adds a runtime value and the
provenance needed to redeploy, not a second kind of plugin.

Revision ID: 0008
Revises: 0007
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("plugins", sa.Column("source_repo", sa.Text(), nullable=True))
    op.add_column("plugins", sa.Column("source_ref", sa.Text(), nullable=True))
    #: The runner's own identifier for the deployment, opaque to us.
    op.add_column("plugins", sa.Column("deployment_id", sa.Text(), nullable=True))
    op.add_column("plugins", sa.Column("deployment_status", sa.Text(), nullable=True))

    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container')",
    )

    # A container agent is reached over HTTP like any external app, so it needs a URL
    # too — the existing constraint only demanded one of 'external'.
    op.drop_constraint("plugins_external_needs_url", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_external_needs_url",
        "plugins",
        "runtime = 'local' OR request_url IS NOT NULL",
    )

    op.create_check_constraint(
        "plugins_container_needs_repo",
        "plugins",
        "runtime <> 'container' OR source_repo IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("plugins_container_needs_repo", "plugins", type_="check")

    op.drop_constraint("plugins_external_needs_url", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_external_needs_url",
        "plugins",
        "runtime <> 'external' OR request_url IS NOT NULL",
    )

    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check", "plugins", "runtime IN ('local', 'external')"
    )

    op.drop_column("plugins", "deployment_status")
    op.drop_column("plugins", "deployment_id")
    op.drop_column("plugins", "source_ref")
    op.drop_column("plugins", "source_repo")
