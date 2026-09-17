"""What a workspace tells the agent it was given.

`plugins.instructions` is a per-workspace text Blob sends with **every** run to the
seeded agent, as `forwardedProps.instructions` — Janus 0.17.0 reads it as an ephemeral
system prompt for that run, up to 4000 characters. It belongs here rather than in
Janus's own configuration because one container serves every workspace on the instance:
a prompt set there would belong to all of them at once, and a workspace's standing
instruction ("we ship on Thursdays", "answer in Serbian") is that workspace's own.

**Nothing sends it to an app installed by hand.** The column exists on every row because
the seeded agent is an ordinary `plugins` row with no exemptions, but the two routes that
write it refuse an owned agent, and the console shows the field only for the agent the
workspace was seeded with. An app an admin registered never sees a field its author did
not declare.

NULL, not empty: a workspace with nothing to say sends no key at all, so an agent never
prepends an empty line to its prompt.

Revision ID: 0043
Revises: 0042
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("plugins", sa.Column("instructions", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("plugins", "instructions")
