"""Named sets of people, mentionable as one handle.

Three tables, and the third is the interesting one.

`user_groups` and `user_group_members` are ordinary. The membership primary key is the
pair, so re-adding somebody is `ON CONFLICT DO NOTHING` rather than a read two admins
could both pass — the argument `0014_saved_items` makes for its own key.

`workspace_handles` exists because group handles and display names share the namespace a
mention is resolved against, and a pair of application checks cannot keep them apart. Not
because of a race — through a supported flow. `users_display_name_uniq` is partial on
`deactivated_at IS NULL`, so a group-create check *must* ignore deactivated people, or a
departed account holds a name forever, which is the exact thing the partial index exists
to prevent. Deactivate somebody, create a group with their handle, reactivate them: both
checks passed, the collision exists, and no index in either table can see it. There are
also six writers of an active display name in this codebase, not two — signup, two
workspace paths, `PATCH /api/me`, the bot minted at app install, and the seed.

So a name is *allocated* rather than checked: winning `(workspace_id, handle_lower)` is
what makes it yours. This repo has already ruled that way twice for the easier one-table
case — see `plugins/manifest.py` on command names. A shared table restores the escape
hatch that looked unavailable when two tables were involved.

Rows exist only for **active** users, deliberately reproducing the partial index's
semantics: deactivating releases the handle, reactivating re-claims it, and the 23505 is
the conflict `admin.reactivate` already raises — now covering groups for nothing.

`messages.mention_group_ids` keeps a group mention *as a group*. Flattening it into
`mention_user_ids` would have been a smaller diff and is wrong: that array means "people
this message named directly", and five things read it that way — the notifier, the agent
dispatcher twice, the action-item assignee, and the client's own "mentions you" accent.
`@channel` puts nothing in it and therefore wakes no agents; a flattened group mention
would have been strictly more powerful than `@channel`, which is not a power anyone asked
for.

Revision ID: 0015
Revises: 0014
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

UUID = sa.dialects.postgresql.UUID(as_uuid=False)


def upgrade() -> None:
    op.create_table(
        "user_groups",
        sa.Column("id", UUID, primary_key=True),
        sa.Column(
            "workspace_id",
            UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("handle", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text()),
        # SET NULL: an admin leaving must not delete the groups they set up.
        sa.Column("created_by", UUID, sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        # The charset is the intersection of what both mention parsers tokenise and what
        # neither markdown renderer eats: no leading underscore (`_MENTION_RE` rejects
        # it), no underscore at all (`_italic_`), no spaces (the server matches 4 words
        # and the client 2), no `.` or `'` (stripped as trailing punctuation).
        sa.CheckConstraint("handle ~ '^[a-z0-9][a-z0-9-]{1,31}$'", name="user_groups_handle_check"),
        sa.UniqueConstraint("workspace_id", "handle", name="user_groups_handle_uniq"),
    )
    op.create_index("user_groups_workspace", "user_groups", ["workspace_id"])

    op.create_table(
        "user_group_members",
        sa.Column(
            "group_id", UUID, sa.ForeignKey("user_groups.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("muted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("group_id", "user_id", name="user_group_members_pkey"),
    )
    # The PK's leading column answers "who is in these groups"; this answers "which
    # groups am I in", which every bootstrap asks.
    op.create_index("user_group_members_user", "user_group_members", ["user_id"])

    op.create_table(
        "workspace_handles",
        sa.Column(
            "workspace_id",
            UUID,
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Always written as SQL lower(), never Python's — the two disagree on "İ".
        sa.Column("handle_lower", sa.Text(), nullable=False),
        sa.Column("user_id", UUID, sa.ForeignKey("users.id", ondelete="CASCADE")),
        sa.Column("group_id", UUID, sa.ForeignKey("user_groups.id", ondelete="CASCADE")),
        sa.PrimaryKeyConstraint("workspace_id", "handle_lower", name="workspace_handles_pkey"),
        # Owned by exactly one thing: nothing is unresolvable, two is ambiguous again.
        sa.CheckConstraint(
            "num_nonnulls(user_id, group_id) = 1", name="workspace_handles_owner_check"
        ),
    )
    # A rename that claims the new handle and forgets to release the old one would leave
    # one person answering to two names, and mis-ping with nothing logged.
    op.create_index(
        "workspace_handles_user",
        "workspace_handles",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "workspace_handles_group",
        "workspace_handles",
        ["group_id"],
        unique=True,
        postgresql_where=sa.text("group_id IS NOT NULL"),
    )

    # Safe precisely because `users_display_name_uniq` already guarantees no duplicates
    # among active users — the backfill cannot violate the primary key it is filling.
    op.execute(
        """
        INSERT INTO workspace_handles (workspace_id, handle_lower, user_id)
        SELECT workspace_id, lower(display_name), id
          FROM users
         WHERE deactivated_at IS NULL
        """
    )

    op.add_column(
        "messages",
        sa.Column(
            "mention_group_ids",
            sa.dialects.postgresql.ARRAY(UUID),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column("messages", "mention_group_ids")
    op.drop_index("workspace_handles_group", table_name="workspace_handles")
    op.drop_index("workspace_handles_user", table_name="workspace_handles")
    op.drop_table("workspace_handles")
    op.drop_index("user_group_members_user", table_name="user_group_members")
    op.drop_table("user_group_members")
    op.drop_index("user_groups_workspace", table_name="user_groups")
    op.drop_table("user_groups")
