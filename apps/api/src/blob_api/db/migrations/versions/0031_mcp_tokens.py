"""A token that lets somebody's own assistant read and write as them.

Blob already has two kinds of caller: a person with a session cookie, and an app with a
bot token that acts as its own bot user. This is a third, and it is neither — it is *the
person*, reached from outside the browser. An assistant holding one of these sees exactly
the channels its owner sees, posts under their name, and disappears from every private
channel the moment they are removed from it, because every tool call goes through the
same `assert_channel_access` the browser goes through.

That is the whole reason the token belongs to a user rather than to a plugin. A bot user
would have needed inviting into channels, would have shown up in the member list, and
would have made "what can my assistant see?" a second question with a second answer. This
way there is only ever one.

`scopes` is `{read}` or `{read,write}` and nothing else — the CHECK says so. A read-only
token is the sane default for "let Claude look at my workspace", and the write half is
the one worth a second thought, so it is a separate decision at minting time rather than
a permission granted by silence.

Revision ID: 0031
Revises: 0030
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

_UUID = sa.dialects.postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "mcp_tokens",
        sa.Column("id", _UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            _UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        #: CASCADE, not SET NULL: a token with no owner is a token with no permissions to
        #: derive, and leaving one behind would be a credential nobody can see to revoke.
        sa.Column("user_id", _UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        #: What the person called it — "Claude Code on the laptop". Shown in the list they
        #: revoke from, which is the only way to tell two tokens apart after minting.
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False, unique=True),
        sa.Column(
            "scopes",
            sa.dialects.postgresql.ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{read}'::text[]"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "scopes <@ ARRAY['read', 'write']::text[] AND 'read' = ANY(scopes)",
            name="mcp_tokens_scopes_check",
        ),
    )
    # The list a person sees is their own live tokens, newest first.
    op.create_index(
        "mcp_tokens_owner",
        "mcp_tokens",
        ["user_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("mcp_tokens_owner", table_name="mcp_tokens")
    op.drop_table("mcp_tokens")
