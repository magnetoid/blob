"""Getting in: founding a workspace, joining one by invitation, and the invitations.

The SQL behind the signup and invitation routes. Signup is the one path that mints an
account, and it keeps the rule `services/workspaces` exists for: one email is one
person with one password, everywhere. This module is also the seam single sign-on will
need — an identity provider's verified email lands here, on the same account-linking
rule, rather than in a second signup.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import hash_password, hash_token, verify_password
from ..lib.errors import bad_request, conflict, not_found, unauthorized, unique_violation
from ..lib.ids import new_id, new_token
from ..schemas.base import iso
from ..schemas.models import CurrentUser
from . import audit as audit_service
from . import handles as handle_service
from . import workspaces as workspace_service
from .audit import Actor
from .channels import DEFAULT_CHANNELS, add_members
from .serialize import USER_COLUMNS, to_current_user


async def needs_setup(session: AsyncSession) -> bool:
    """Is this a fresh install? The first person to sign up founds the workspace."""
    row = (await session.execute(text("SELECT count(*) AS count FROM workspaces"))).fetchone()
    return (row.count if row else 0) == 0


async def _open_invite(session: AsyncSession, token: str) -> Any:
    return (
        await session.execute(
            text(
                """
                SELECT id, email, role, workspace_id FROM invites
                 WHERE token_hash = :token_hash
                   AND accepted_at IS NULL
                   AND revoked_at IS NULL
                   AND expires_at > now()
                """
            ),
            {"token_hash": hash_token(token)},
        )
    ).fetchone()


async def signup(
    session: AsyncSession,
    *,
    email: str,
    password: str,
    display_name: str,
    workspace_name: str | None,
    invite_token: str | None,
) -> tuple[str, CurrentUser]:
    """Create the account, and say whose it is.

    Only "is this a fresh install?" is read from the workspaces table — *which*
    workspace someone joins comes from their invitation, never from that row. Reading
    the workspace and using it for the join was correct while there was one; with two it
    silently put people into the oldest one whatever they had been invited to.
    """
    email = email.lower()
    workspace = (
        await session.execute(text("SELECT id FROM workspaces ORDER BY created_at LIMIT 1"))
    ).fetchone()

    if workspace is None:
        # First ever signup founds the workspace, through the one path that makes one —
        # see services/workspaces.found, which also seeds its default channels. Its
        # founder becomes the server's first instance admin: there is nobody else to
        # be, and a server whose instance console nobody can open has no way back.
        try:
            founded = await workspace_service.found(
                session,
                name=(workspace_name or "").strip() or "Workspace",
                email=email,
                display_name=display_name,
                password_hash=await hash_password(password),
                grant_admin=True,
            )
        except Exception as exc:
            if unique_violation(exc):
                raise conflict(
                    "That email or display name is already taken.", "user_exists"
                ) from exc
            raise
        user_id = founded.owner_user_id
    else:
        if not invite_token:
            raise unauthorized("You need an invitation to join.")
        invite = await _open_invite(session, invite_token)
        if invite is None:
            raise unauthorized("That invitation has expired or was already used.")
        if invite.email and invite.email.lower() != email:
            raise bad_request("That invitation was issued for a different email address.")
        role = getattr(invite, "role", None) or "member"
        # The invitation says which workspace. It always did; nothing read it.
        workspace_id = invite.workspace_id

        # One email is one person, with one password — the rule `services/workspaces`
        # exists to keep, and this path was the one place that minted a second hash for
        # the same address. Joining a second workspace by invitation looked like it
        # worked and handed back a cookie; the next sign-in picked the older row, checked
        # the new password against the old hash, and answered "That email or password is
        # incorrect" with nothing on screen to explain it.
        #
        # The existing hash is reused rather than overwritten. An invitation is issued
        # by *this* workspace's admin: letting whoever holds the link set the password on
        # an account in another workspace would be an account takeover dressed as an
        # invite.
        existing_hash = await workspace_service.password_hash_for(session, email)
        if existing_hash is not None and not await verify_password(existing_hash, password):
            # Two sentences, and which one depends on whether the link named the address.
            # An invitation issued *to* somebody already says their address is known to
            # whoever sent it, so telling them plainly costs nothing and saves them
            # guessing. An open link names nobody, and can be forwarded — so answering
            # "this address already has an account" would turn it into a way to ask the
            # server about addresses it was never given. That one gets the sentence
            # login gives, which asserts nothing either way; the signup rate limit is
            # what bounds the asking.
            named = bool(getattr(invite, "email", None))
            raise bad_request(
                "This address already has a Blob account. Use that password to join this workspace."
                if named
                else "That email or password is incorrect.",
                code="invalid_input",
            )
        password_hash = existing_hash or await hash_password(password)
        user_id = new_id()
        try:
            await session.execute(
                text(
                    """
                    INSERT INTO users
                      (id, workspace_id, email, password_hash, display_name, role)
                    VALUES (:id, :ws, :email, :password_hash, :display_name, :role)
                    """
                ),
                {
                    "id": user_id,
                    "ws": workspace_id,
                    "email": email,
                    "password_hash": password_hash,
                    "display_name": display_name,
                    "role": role,
                },
            )
            # Inside the same try: the name is mentionable, so it has to be allocated as
            # well as stored, and losing that index is the same conflict losing the
            # display-name index already is.
            await handle_service.claim(session, workspace_id, display_name, user_id=user_id)
        except Exception as exc:
            if unique_violation(exc):
                raise conflict(
                    "That email or display name is already taken.", "user_exists"
                ) from exc
            raise

        defaults = (
            await session.execute(
                text(
                    """
                    SELECT id FROM channels
                     WHERE workspace_id = :ws AND kind = 'public'
                       AND name = ANY(cast(:names AS text[]))
                    """
                ),
                {"ws": workspace_id, "names": list(DEFAULT_CHANNELS)},
            )
        ).fetchall()
        for row in defaults:
            await add_members(session, channel_id=row.id, user_ids=[user_id])

        await session.execute(
            text(
                """
                UPDATE invites SET accepted_at = now(), accepted_by = :user_id
                 WHERE token_hash = :token_hash
                """
            ),
            {"user_id": user_id, "token_hash": hash_token(invite_token)},
        )

    created = (
        await session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
        )
    ).fetchone()
    if created is None:
        raise bad_request("Could not create that account.")
    return user_id, to_current_user(created)


# ─── invitations ──────────────────────────────────────────────────────────────


async def create_invite(
    session: AsyncSession,
    actor: Actor,
    *,
    email: str | None,
    role: str,
    expires_in_days: int,
) -> tuple[str, str, str]:
    """Mint an invitation. Returns the raw token, when it expires, and the workspace name."""
    token = new_token()
    invite_id = new_id()
    row = (
        await session.execute(
            text(
                """
                INSERT INTO invites
                  (id, workspace_id, email, token_hash, created_by, expires_at, role)
                VALUES (:id, :ws, :email, :token_hash, :created_by,
                        now() + make_interval(days => :days), :role)
                RETURNING expires_at
                """
            ),
            {
                "id": invite_id,
                "ws": actor.workspace_id,
                "email": email.lower() if email else None,
                "token_hash": hash_token(token),
                "created_by": actor.id,
                "days": expires_in_days,
                "role": role,
            },
        )
    ).fetchone()
    if row is None:
        raise bad_request("Could not create that invitation.")
    # Minting a way into the workspace — and an admin-role invitation is a way to mint
    # an admin. The revocation was already logged; the creation was not.
    await audit_service.record(
        session,
        actor,
        "invite.created",
        target_type="invite",
        target_id=invite_id,
        metadata={"email": email, "role": role},
    )
    workspace = (
        await session.execute(
            text("SELECT name FROM workspaces WHERE id = :id"), {"id": actor.workspace_id}
        )
    ).fetchone()
    return token, iso(row.expires_at) or "", workspace.name if workspace else "the workspace"


async def preview_invite(session: AsyncSession, token: str) -> tuple[str | None, str]:
    """What an open invitation is for: the address it names, and the workspace."""
    invite = (
        await session.execute(
            text(
                """
                SELECT i.email, w.name AS workspace
                  FROM invites i JOIN workspaces w ON w.id = i.workspace_id
                 WHERE i.token_hash = :token_hash
                   AND i.accepted_at IS NULL
                   AND i.revoked_at IS NULL
                   AND i.expires_at > now()
                """
            ),
            {"token_hash": hash_token(token)},
        )
    ).fetchone()
    if invite is None:
        raise not_found("That invitation has expired or was already used.")
    return invite.email, invite.workspace
