"""What a workspace is allowed to do to the machine it runs on.

Every app endpoint is gated on `require_admin` — a *workspace* admin. That was the whole
story while one workspace was the server, because the workspace admin and the person who
owned the hardware were the same person. Multi-workspace split them, and nothing moved:
a workspace admin can still register an external app, deploy an agent from any repository
onto the operator's box, and hold a socket connection into this process. The operator
gets no say.

This is the say. A row per workspace, and deliberately **not** in `workspace_settings` —
that table is a JSONB blob a workspace admin edits through `PATCH /api/admin/settings`,
and policy that its subject can edit is not policy. Instance admins write here; workspace
admins have no endpoint that touches it.

Two rules make it composable rather than confusing:

* **The environment is the ceiling.** `AGENT_RUNNER` and `AGENT_ALLOW_PRIVATE_ENDPOINTS`
  still decide what the *server* can do at all. Policy narrows that per workspace and can
  never widen it, so an operator who turned hosting off globally cannot be surprised by a
  policy row turning it back on.
* **No row means the column defaults.** One place decides what a workspace starts with,
  rather than an INSERT somewhere in workspace creation that drifts from the DDL.

The defaults are closed for the two capabilities that reach the host and open for the one
that does not. Existing workspaces are seeded permissive instead, because those
capabilities were available to them yesterday and an upgrade that quietly revokes them
would read as a bug, not a policy.

Revision ID: 0013
Revises: 0012
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_policies",
        sa.Column(
            "workspace_id",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        # Reaches the host: the repository's code runs as a container on the operator's
        # hardware. Closed by default. See ADR 0010.
        sa.Column(
            "may_host_agents", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        # Reaches the operator's network: relaxes the SSRF guard that stops a registered
        # app URL pointing at a database or a metadata endpoint. Closed by default.
        sa.Column(
            "may_use_private_endpoints",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        # Reaches nothing it was not already given: a socket agent holds a connection and
        # answers runs, with the scopes it was granted and no more. Open by default.
        sa.Column(
            "may_connect_socket_agents",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        # Scopes no app in this workspace may hold, whatever an admin approves.
        sa.Column(
            "denied_scopes",
            sa.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        # NULL means no cap.
        sa.Column("max_apps", sa.Integer(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_by",
            sa.dialects.postgresql.UUID(as_uuid=False),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Everything that already exists keeps what it already had.
    op.execute(
        """
        INSERT INTO workspace_policies
            (workspace_id, may_host_agents, may_use_private_endpoints,
             may_connect_socket_agents)
        SELECT id, true, true, true FROM workspaces
        """
    )


def downgrade() -> None:
    op.drop_table("workspace_policies")
