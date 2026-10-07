"""AG-UI 1.0: what an agent says it speaks, whether its reasoning is shown, and what a run cost.

Three columns, each holding something an agent tells Blob or a workspace decides about it.

`plugins.agui_version` is the protocol version the agent last declared in
`RUN_STARTED.protocolVersion`. AG-UI 1.0 asks a client to send its own version on every
run *except* to a peer it knows predates the field — and the Python SDK forbade unknown
input fields until 0.1.10, so a `protocolVersion` handed to an older agent is a
422 that looks exactly like the agent being down. Blob cannot know in advance; the agent
says, in the first run, and from then on Blob speaks 1.0 to it. NULL means it never said.

`plugins.shows_reasoning` is the per-agent switch for the reasoning tail on the run card.
Off by default, because the card is the whole channel's and an agent's working-out is
where it narrates what it read.

`agent_runs.usage` is the token usage the agent reported on `RUN_FINISHED` (or
`RUN_ERROR`), as the protocol shapes it: a list, one entry per provider and model. The
budget has only ever been able to count runs and seconds, because AG-UI did not carry
tokens; 1.0 does.

Revision ID: 0046
Revises: 0045
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plugins", sa.Column("agui_version", sa.Text(), nullable=True))
    op.add_column(
        "plugins",
        sa.Column("shows_reasoning", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("agent_runs", sa.Column("usage", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("agent_runs", "usage")
    op.drop_column("plugins", "shows_reasoning")
    op.drop_column("plugins", "agui_version")
