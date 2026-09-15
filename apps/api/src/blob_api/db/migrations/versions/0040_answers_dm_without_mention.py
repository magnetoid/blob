"""Which agents are addressed by their DM — no `@name` needed.

Today only the built-in agent answers its DM without a mention, and
`jobs/agui_admission.personal_agent_for` says why it was never "any bot in a DM":
widening the trigger would hand every installed third-party app a run for every line
typed at it, with no manifest opt-in and no way for its author to decline. That reasoning
stands. So the property is made explicit: `answers_dm_without_mention` is set only by the
seeders — the agents Blob itself presents as *the* assistant — and the send path and the
job read it. A person's own agent is the other case and needs no flag: `owner_user_id`
being the one person in the room is the whole condition.

Two flags rather than one with two meanings: `in_every_public_channel` (0039) says where
the bot *is*, this says how it may be *addressed*.

Backfilled by the seeders' own identity — the same predicate 0039 used.

Revision ID: 0040
Revises: 0039
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plugins",
        sa.Column(
            "answers_dm_without_mention",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.execute(
        """
        UPDATE plugins
           SET answers_dm_without_mention = true
         WHERE owner_user_id IS NULL
           AND ((slug = 'blob-agent' AND runtime = 'builtin')
             OR (slug = 'janus' AND runtime = 'external'))
        """
    )


def downgrade() -> None:
    op.drop_column("plugins", "answers_dm_without_mention")
