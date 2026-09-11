"""Let the agent already installed everywhere see who is in the workspace.

`services/workspace_agent.py` grants its scopes at **install** and never again. That is
deliberate — `ensure` runs at every startup and means "make sure this workspace has the
agent", and if it reconciled grants then a scope an admin revoked would come back on the
next restart, which would make the revoke button a lie. The cost of that choice is this
file: a scope the built-in agent newly needs has to be given to the installs that already
exist, once, by hand.

`users:read` is what `list_people` asks for. Without it the agent could read every channel
the person asking can read and still not name anybody in them — and naming people is most
of what gets asked, as well as how the hand-off rule works, since passing work to another
agent means writing its @name.

Scoped to the built-in runtime. Every other app's scopes are what its own manifest asked
for and a person approved; widening those from a migration would be granting a permission
nobody consented to.

Revision ID: 0036
Revises: 0035
"""

from __future__ import annotations

from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ON CONFLICT rather than NOT EXISTS: the unique index is the authority on whether a
    # grant is already held, and a workspace founded between this statement being written
    # and it being run will already have the row from `AGENT_SCOPES`.
    op.execute(
        """
        INSERT INTO plugin_grants (plugin_id, scope)
        SELECT p.id, 'users:read' FROM plugins p WHERE p.runtime = 'builtin'
        ON CONFLICT DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM plugin_grants WHERE scope = 'users:read' AND plugin_id IN "
        "(SELECT id FROM plugins WHERE runtime = 'builtin')"
    )
