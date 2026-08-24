"""An agent that dials in rather than being dialled.

Every runtime before this one is reached by Blob making a request to an address:
`external` and `container` both mean "here is a URL, call it". That works for anything
with a hostname and falls apart for the case people actually keep asking for — an agent
running on their own machine, behind NAT, on a network this server has never heard of
and cannot route to. There is no URL to give.

So `socket` reverses the direction: the agent opens a WebSocket to Blob, authenticates
with its bot token, and holds it. Runs are written down that pipe and the agent's AG-UI
events come back up it. Nothing about the agent has to be addressable, which is the
whole point — the same reason Slack shipped Socket Mode.

Schema-wise this is one widened check constraint. A socket agent stores no
`request_url` and no `agui_url`, and the constraint that demands one already applies to
`external` alone, so nothing else moves. Where the connection *is* lives in Redis with a
TTL rather than in a column: it is liveness, it changes on every reconnect, and a row
saying "connected" that outlives the process holding the socket is worse than no row.

Revision ID: 0012
Revises: 0011
"""

from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container', 'socket')",
    )


def downgrade() -> None:
    # Anything that dialled in has no URL to fall back to, so it cannot be re-expressed
    # as another runtime. Remove them rather than leave rows the constraint forbids.
    op.execute("DELETE FROM plugins WHERE runtime = 'socket'")
    op.drop_constraint("plugins_runtime_check", "plugins", type_="check")
    op.create_check_constraint(
        "plugins_runtime_check",
        "plugins",
        "runtime IN ('local', 'external', 'container')",
    )
