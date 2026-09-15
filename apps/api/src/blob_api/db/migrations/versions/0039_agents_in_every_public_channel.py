"""Which agents are in every public channel — the ones founded later included.

The agents Blob seeds — its own, and Janus when it runs in this stack — are put into
every public channel at seeding, because a mention needs membership: a bot that is not in
the room is refused by `assert_channel_access(require_member=True)` and the mention is
dropped with no message, no error and no run row. Nothing put them into a channel founded
*after* the seeding, so an agent that answered in #general was silently deaf in every
room created since, until the next restart at best.

`plugins.in_every_public_channel` is the property that was implicit: the seeders set it
at install and `services/channels.create_channel` reads it. It is off for anything an
admin installs by hand — an app is invited room by room, and membership is also how far
its `messages:write` reaches, so widening it silently would widen every app's reach.

Backfilled onto the rows the seeders own, by the same identity the seeders use
(`services/workspace_agent.existing_id`, `services/janus_agent.existing_id`): a person's
own agent called "Janus" wears the slug and must not get it.

Revision ID: 0039
Revises: 0038
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "plugins",
        sa.Column(
            "in_every_public_channel",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.execute(
        """
        UPDATE plugins
           SET in_every_public_channel = true
         WHERE owner_user_id IS NULL
           AND ((slug = 'blob-agent' AND runtime = 'builtin')
             OR (slug = 'janus' AND runtime = 'external'))
        """
    )


def downgrade() -> None:
    op.drop_column("plugins", "in_every_public_channel")
