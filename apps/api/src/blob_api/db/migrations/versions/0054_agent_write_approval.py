"""When an agent's posts wait for the person it works for (M1 · A3).

`plugins.write_approval` decides, for an agent with `tool_access = 'write'`, which of its
`post_message` calls are put to the person first:

- `ask` — every one. What every agent did until now, and what every row is set to here,
  existing and new: nothing changes until an admin decides, on the agent's page.
- `auto_in_dm` — not when the person asked in their own DM with the agent, where nobody
  else's words can have steered it; still every one asked anywhere else.
- `auto_everywhere` — never.

None of it widens where a post may go: the person must be able to write there, the bot
must be a member, and asked in a channel the target must be that room or a public one.
These are the three Mattermost settled on for multiplayer tool calling, for the same
reason — the risk is the room the instruction came from, not the tool.

Revision ID: 0054
Revises: 0053
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0054"
down_revision = "0053"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plugins",
        sa.Column("write_approval", sa.Text(), nullable=False, server_default=sa.text("'ask'")),
    )
    op.create_check_constraint(
        "plugins_write_approval_check",
        "plugins",
        "write_approval IN ('ask', 'auto_in_dm', 'auto_everywhere')",
    )


def downgrade() -> None:
    op.drop_constraint("plugins_write_approval_check", "plugins", type_="check")
    op.drop_column("plugins", "write_approval")
