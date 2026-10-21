"""Getting in: founding a workspace, joining one by invitation, and the invitations.

The SQL behind the signup and invitation routes. Signup is the one path that mints an
account, and it keeps the rule `services/workspaces` exists for: one email is one
person with one password, everywhere. It is also where single sign-on makes an account
(`join_by_identity`, ADR 0033): an identity provider's verified address lands here, by
invitation or into the provider's own workspace, rather than in a second signup — with
no password of its own, carrying the one the address already has if it has one.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import hash_password, hash_token, verify_password
from ..lib.errors import (
    AppError,
    bad_request,
    conflict,
    not_found,
    unauthorized,
    unique_violation,
)
from ..lib.ids import new_id, new_token
from ..schemas.base import iso
from ..schemas.models import CurrentUser
from . import accounts as account_service
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
        if existing_hash is None and await _has_accounts(session, email):
            # The address is somebody who signs in another way — single sign-on, or a
            # passkey alone — and has no password anywhere. Setting one here would hand
            # whoever holds this link a way into that person's other workspaces.
            raise bad_request(
                "This address signs in without a password. Use that way to join.",
                code="invalid_input",
            )
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
        user_id = await _create_account(
            session,
            workspace_id=workspace_id,
            email=email,
            password_hash=password_hash,
            display_name=display_name,
            role=role,
            elsewhere=existing_hash is not None,
        )
        await _accept(session, invite_token, user_id)

    created = (
        await session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
        )
    ).fetchone()
    if created is None:
        raise bad_request("Could not create that account.")
    # True for the founder of a fresh server, granted inside this same transaction, and
    # for anybody joining by invitation whose address already runs this one.
    instance_admin = await workspace_service.is_instance_admin(session, email)
    return user_id, to_current_user(created, is_instance_admin=instance_admin)


async def _has_accounts(session: AsyncSession, email: str) -> bool:
    row = (
        await session.execute(
            text("SELECT 1 FROM users WHERE email = :email AND kind = 'human' LIMIT 1"),
            {"email": email},
        )
    ).fetchone()
    return row is not None


async def _create_account(
    session: AsyncSession,
    *,
    workspace_id: str,
    email: str,
    password_hash: str | None,
    display_name: str,
    role: str,
    elsewhere: bool,
) -> str:
    """The row, its handle, the default channels. `elsewhere` when the address already
    holds an account in another workspace."""
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
            raise conflict("That email or display name is already taken.", "user_exists") from exc
        raise
    if elsewhere:
        # The address now holds accounts in two workspaces, which only a server
        # administrator may unlock (services/admin) — so a reset link minted while
        # it held one, by an admin of the first, must not outlive the change.
        await account_service.retire_resets(session, email=email)

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
    return user_id


async def _accept(session: AsyncSession, invite_token: str, user_id: str) -> None:
    await session.execute(
        text(
            """
            UPDATE invites SET accepted_at = now(), accepted_by = :user_id
             WHERE token_hash = :token_hash
            """
        ),
        {"user_id": user_id, "token_hash": hash_token(invite_token)},
    )


async def _free_name(session: AsyncSession, workspace_id: str, wanted: str) -> str:
    """`wanted`, or the first of "wanted 2", "wanted 3"… nobody in the workspace has taken
    — a person or a group, since both are mentionable. For an account made from an
    identity provider's claims, which nobody chose and nobody can be asked to change."""
    base = wanted.strip()[:36] or "New member"
    for suffix in range(1, 50):
        candidate = base if suffix == 1 else f"{base} {suffix}"
        taken = (
            await session.execute(
                text(
                    """
                    SELECT 1 FROM workspace_handles
                     WHERE workspace_id = :ws AND handle_lower = lower(:name)
                    """
                ),
                {"ws": workspace_id, "name": candidate},
            )
        ).fetchone()
        if taken is None:
            return candidate
    return f"{base} {new_token()[:4]}"


async def join_by_identity(
    session: AsyncSession,
    *,
    email: str,
    display_name: str,
    invite_token: str | None,
    workspace_id: str | None,
) -> str:
    """An account for an address an identity provider vouched for (ADR 0033).

    By the invitation the person arrived with, on the invitation's terms (its workspace,
    its role, and its address if it named one); otherwise into the workspace the provider
    lets new people join, as a member. With no password of its own — the address's, if it
    already has one somewhere, so the one-password rule holds — and a display name made
    unique, since nobody chose it.
    """
    email = email.lower()
    role = "member"
    if invite_token:
        invite = await _open_invite(session, invite_token)
        if invite is None:
            raise AppError(
                400, "invite_expired", "That invitation has expired or was already used."
            )
        if invite.email and invite.email.lower() != email:
            raise AppError(
                400,
                "invite_wrong_address",
                "That invitation was issued for a different email address.",
            )
        workspace_id = str(invite.workspace_id)
        role = getattr(invite, "role", None) or "member"
    if workspace_id is None:
        raise AppError(400, "no_account", "There is no account here for that address.")
    present = (
        await session.execute(
            text("SELECT id FROM users WHERE workspace_id = :ws AND email = :email"),
            {"ws": workspace_id, "email": email},
        )
    ).fetchone()
    if present is not None:
        return str(present.id)
    existing_hash = await workspace_service.password_hash_for(session, email)
    user_id = await _create_account(
        session,
        workspace_id=workspace_id,
        email=email,
        password_hash=existing_hash,
        display_name=await _free_name(session, workspace_id, display_name),
        role=role,
        elsewhere=await _has_accounts(session, email),
    )
    if invite_token:
        await _accept(session, invite_token, user_id)
    return user_id


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
