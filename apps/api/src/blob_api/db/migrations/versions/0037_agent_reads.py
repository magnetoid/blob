"""How far a shared agent may read when it answers in a room.

ADR 0013 bounds an agent's *command* authority: the person who rooted a chain is whose
authority flows down it. Nothing bounded what it may *read* on that authority, and
`jobs/agui_admission.agent_tools` hands the asker's full reach to whichever agent was
mentioned — so `@Blob summarise #salaries` typed in `#general` worked, and the answer
landed in `#general`, where the room can read what the room could not open.

`agent_reads` is that bound, per workspace:

* `audience` — in a DM with the agent, everything the asker can see, which is the
  promise the agent's own DM makes; in a channel, only public channels and that
  channel. The room never learns more than the room could have read for itself.
* `asker` — the old behaviour, for a workspace that wants it back.

Existing rows are set to `audience` rather than to the behaviour they had. This one is
deliberately not the precedent migration 0013 set for the host capabilities: leaving a
workspace permissive avoids surprising an admin, and here the surprise would be a
private channel quoted into a public one. A tightening that nobody has to notice is the
safe direction; the switch is in the instance console for anyone who wants the old
reach back.

A person's own MCP token is untouched. ADR 0016: that credential *is* the person, it
answers only them, and there is no room for it to leak into.

Revision ID: 0037
Revises: 0036
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_policies",
        sa.Column(
            "agent_reads",
            sa.Text(),
            nullable=False,
            server_default="audience",
        ),
    )
    op.create_check_constraint(
        "workspace_policies_agent_reads_check",
        "workspace_policies",
        "agent_reads IN ('audience', 'asker')",
    )


def downgrade() -> None:
    op.drop_constraint("workspace_policies_agent_reads_check", "workspace_policies")
    op.drop_column("workspace_policies", "agent_reads")
