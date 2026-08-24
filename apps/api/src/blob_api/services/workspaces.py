"""More than one workspace on one server.

The schema allowed this before anything used it: `users` is unique on
(workspace_id, email) rather than on email, so one address has always been able to hold a
row in several workspaces. That is Slack's model, and adopting it means **a person is
several user rows**, one per workspace — not one row with a list of memberships. Nothing
in the hot paths changes, because `users.workspace_id` still means exactly what every
tuned query already assumes it means.

What that model does cost is one rule, and every auth path has to keep it:

    one email is one person, with one password, replicated across their rows.

`login` picks a row deterministically and checks the password there; a reset writes to
*every* row for that address; joining a second workspace copies the hash across rather
than asking for a new one. Break that rule anywhere and the failure is a person who can
sign into one of their workspaces and not another, with nothing on screen to explain it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.errors import bad_request, conflict, not_found
from ..lib.ids import new_id
from .channels import DEFAULT_CHANNELS, add_members


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
    return slug or "workspace"


@dataclass(slots=True)
class Founded:
    workspace_id: str
    slug: str
    owner_user_id: str


async def is_instance_admin(session: AsyncSession, email: str) -> bool:
    """Whether this person administers the server, as opposed to a workspace on it."""
    row = (
        await session.execute(
            text("SELECT 1 FROM instance_admins WHERE email = :email"), {"email": email}
        )
    ).fetchone()
    return row is not None


async def grant_instance_admin(session: AsyncSession, email: str) -> None:
    await session.execute(
        text(
            """
            INSERT INTO instance_admins (email) VALUES (:email)
            ON CONFLICT (email) DO NOTHING
            """
        ),
        {"email": email},
    )


async def for_email(session: AsyncSession, email: str) -> list[Any]:
    """Every workspace this person has a live account in, oldest first.

    Oldest first because it is the order they joined, which is the order they think of
    them in — and because `login` uses the same order to decide where a bare sign-in
    lands, so the list and the landing agree.
    """
    return list(
        (
            await session.execute(
                text(
                    """
                    SELECT w.id, w.name, w.slug, u.id AS user_id, u.role
                      FROM users u
                      JOIN workspaces w ON w.id = u.workspace_id
                     WHERE u.email = :email
                       AND u.kind = 'human'
                       AND u.deactivated_at IS NULL
                     ORDER BY u.created_at
                    """
                ),
                {"email": email},
            )
        ).fetchall()
    )


async def _free_slug(session: AsyncSession, wanted: str) -> str:
    """`acme`, then `acme-2`, `acme-3`… — slugs are unique across the whole server.

    Checked in a loop rather than trusted: two workspaces created at the same moment can
    both find the same slug free, so the INSERT is still what decides and the caller
    turns its unique violation into a conflict.
    """
    base = slugify(wanted)
    candidate = base
    suffix = 1
    while True:
        taken = (
            await session.execute(
                text("SELECT 1 FROM workspaces WHERE slug = :slug"), {"slug": candidate}
            )
        ).fetchone()
        if taken is None:
            return candidate
        suffix += 1
        candidate = f"{base}-{suffix}"[:40]


async def password_hash_for(session: AsyncSession, email: str) -> str | None:
    """This person's password, from whichever of their rows still has one.

    The rule this file exists to keep: one email, one password. When someone is added to
    a second workspace the hash comes from here rather than from a new prompt, so they
    sign in everywhere with what they already know.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT password_hash FROM users
                 WHERE email = :email AND password_hash IS NOT NULL AND kind = 'human'
                 ORDER BY created_at
                 LIMIT 1
                """
            ),
            {"email": email},
        )
    ).fetchone()
    return row.password_hash if row else None


async def set_password_everywhere(session: AsyncSession, email: str, password_hash: str) -> None:
    """Write a new password to every row this person has.

    Every row, deliberately. A reset that touched only the row the link was minted for
    would leave the same person unable to sign into their other workspaces with the
    password they just chose — and the reset would look like it worked.
    """
    await session.execute(
        text("UPDATE users SET password_hash = :hash WHERE email = :email AND kind = 'human'"),
        {"email": email, "hash": password_hash},
    )


async def found(
    session: AsyncSession,
    *,
    name: str,
    email: str,
    display_name: str,
    password_hash: str | None,
    grant_admin: bool = False,
) -> Founded:
    """Create a workspace with its founder, their default channels, and nothing else.

    The one path that makes a workspace, used by the first-ever signup and by an instance
    admin creating another. Before this they were the same twenty lines written once,
    which is how the second one would have quietly drifted from the first.
    """
    clean = name.strip()
    if not clean:
        raise bad_request("A workspace needs a name.")

    workspace_id = new_id()
    slug = await _free_slug(session, clean)
    await session.execute(
        text("INSERT INTO workspaces (id, name, slug) VALUES (:id, :name, :slug)"),
        {"id": workspace_id, "name": clean, "slug": slug},
    )

    owner_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO users (id, workspace_id, email, password_hash, display_name, role)
            VALUES (:id, :ws, :email, :password_hash, :display_name, 'owner')
            """
        ),
        {
            "id": owner_id,
            "ws": workspace_id,
            "email": email,
            "password_hash": password_hash,
            "display_name": display_name,
        },
    )

    for channel_name in DEFAULT_CHANNELS:
        channel_id = new_id()
        await session.execute(
            text(
                """
                INSERT INTO channels (id, workspace_id, kind, name, created_by)
                VALUES (:id, :ws, 'public', :name, :created_by)
                """
            ),
            {"id": channel_id, "ws": workspace_id, "name": channel_name, "created_by": owner_id},
        )
        await add_members(session, channel_id, [owner_id])

    if grant_admin:
        await grant_instance_admin(session, email)

    return Founded(workspace_id=workspace_id, slug=slug, owner_user_id=owner_id)


async def user_row_in(session: AsyncSession, workspace_id: str, email: str) -> Any:
    """This person's account in one workspace, or 404 if they have none there.

    404 rather than 403 for the same reason a private channel does: whether an address has
    an account in a workspace it cannot see is not that workspace's business to confirm.
    """
    row = (
        await session.execute(
            text(
                """
                SELECT id, workspace_id FROM users
                 WHERE workspace_id = :ws
                   AND email = :email
                   AND kind = 'human'
                   AND deactivated_at IS NULL
                """
            ),
            {"ws": workspace_id, "email": email},
        )
    ).fetchone()
    if row is None:
        raise not_found("You don't have an account in that workspace.")
    return row


async def add_person(
    session: AsyncSession,
    *,
    workspace_id: str,
    email: str,
    display_name: str,
    role: str = "member",
) -> str:
    """Put an existing person into another workspace, carrying their password across."""
    existing = (
        await session.execute(
            text("SELECT 1 FROM users WHERE workspace_id = :ws AND email = :email"),
            {"ws": workspace_id, "email": email},
        )
    ).fetchone()
    if existing is not None:
        raise conflict("They already have an account in that workspace.", "user_exists")

    user_id = new_id()
    await session.execute(
        text(
            """
            INSERT INTO users (id, workspace_id, email, password_hash, display_name, role)
            VALUES (:id, :ws, :email, :password_hash, :display_name, :role)
            """
        ),
        {
            "id": user_id,
            "ws": workspace_id,
            "email": email,
            "password_hash": await password_hash_for(session, email),
            "display_name": display_name,
            "role": role,
        },
    )
    return user_id
