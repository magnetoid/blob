"""Running one workspace: people, invitations, channels, settings, webhooks.

The SQL behind `routers/admin.py`, which had been the largest router with no service
under it. Every mutation records an audit row here, in the same transaction as the
change, because the record and the change have to commit together or not at all. What
is broadcast afterwards is the router's business: a service returns what changed, and
the route decides who is told.

`owner` is a real role rather than "the admin who signed up first": exactly one exists,
only an owner changes roles, and the owner cannot be deactivated.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..lib import mail
from ..lib.auth import hash_token
from ..lib.errors import (
    bad_request,
    channel_gone,
    conflict,
    forbidden,
    no_such_person,
    not_found,
    unique_violation,
)
from ..lib.ids import new_id, new_token
from ..plugins import recent_errors
from ..schemas.admin import (
    AdminChannel,
    AdminChannelsOut,
    AdminDeliveriesOut,
    AdminDeliveryOut,
    AdminInvite,
    AdminInvitesOut,
    AdminUser,
    AdminUsersOut,
    CreateWebhookInput,
    ResetLinkOut,
    SettingsInput,
    WebhookOut,
    WebhooksOut,
    WorkspaceSettingsOut,
)
from ..schemas.base import iso, require_iso
from ..schemas.models import ChannelWithState, User
from . import audit as audit_service
from . import channels as channel_service
from . import handles as handle_service
from . import passkeys as passkey_service
from . import workspaces as workspace_service
from .accounts import record_event, retire_resets, revoke_assistant_tokens
from .audit import Actor
from .serialize import USER_COLUMNS, to_user
from .slack_history import NO_ADDRESS_DOMAIN
from .workspace_settings import RETENTION_KEYS


def _now_iso() -> str:
    return require_iso(datetime.now(UTC))


async def _user_row(session: AsyncSession, user_id: str) -> User | None:
    row = (
        await session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = :id"), {"id": user_id}
        )
    ).fetchone()
    return to_user(row) if row else None


# ─── people ───────────────────────────────────────────────────────────────────


async def list_users(
    session: AsyncSession,
    workspace_id: str,
    *,
    q: str | None,
    include_deactivated: bool,
    limit: int,
) -> AdminUsersOut:
    rows = (
        await session.execute(
            text(
                """
                SELECT u.id, u.email, u.display_name, u.full_name, u.title, u.role,
                       u.deactivated_at, u.created_at, u.placeholder, u.kind,
                       (SELECT max(s.last_seen_at) FROM sessions s
                         WHERE s.user_id = u.id) AS last_seen_at,
                       (SELECT count(*) FROM sessions s
                         WHERE s.user_id = u.id AND s.expires_at > now())::int
                         AS session_count,
                       (SELECT count(*) FROM channel_members cm
                         WHERE cm.user_id = u.id)::int AS channel_count,
                       (SELECT count(*) FROM messages m
                         WHERE m.author_id = u.id AND m.deleted_at IS NULL)::int
                         AS message_count,
                       COALESCE((SELECT o.two_step FROM passkey_owners o
                                  WHERE o.email = u.email
                                    AND EXISTS (SELECT 1 FROM passkeys p
                                                 WHERE p.email = o.email)), false)
                         AS two_step,
                       count(*) OVER ()::int AS total
                  FROM users u
                 WHERE u.workspace_id = :ws
                   AND (:include_deactivated OR u.deactivated_at IS NULL)
                   AND (cast(:q AS text) IS NULL
                        OR u.display_name ILIKE '%' || :q || '%'
                        OR u.email ILIKE '%' || :q || '%')
                 ORDER BY u.placeholder, u.deactivated_at NULLS FIRST, lower(u.display_name)
                 LIMIT :limit
                """
            ),
            {
                "ws": workspace_id,
                "include_deactivated": include_deactivated,
                "q": q,
                "limit": limit,
            },
        )
    ).fetchall()
    return AdminUsersOut(
        users=[
            AdminUser(
                id=row.id,
                email=row.email,
                display_name=row.display_name,
                full_name=row.full_name,
                title=row.title,
                role=row.role,
                deactivated_at=iso(row.deactivated_at),
                created_at=require_iso(row.created_at),
                last_seen_at=iso(row.last_seen_at),
                session_count=row.session_count,
                channel_count=row.channel_count,
                message_count=row.message_count,
                two_step=row.two_step,
                placeholder=row.placeholder,
                # A person an import kept an account for, at an address that can be mailed —
                # never an app, never an address the export did not have (ADR 0042).
                invitable=row.placeholder
                and row.kind == "human"
                and not row.email.lower().endswith(f"@{NO_ADDRESS_DOMAIN}"),
            )
            for row in rows
        ],
        total=rows[0].total if rows else 0,
    )


async def set_role(session: AsyncSession, owner: Actor, user_id: str, role: str) -> list[User]:
    """Only an owner changes roles, and ownership transfers rather than duplicates.

    Returns every user whose row changed — the target, and the owner when the target
    became the owner — so the route can tell open sessions. Empty when nothing changed.
    """
    target = (
        await session.execute(
            text("SELECT id, role, display_name FROM users WHERE id = :id AND workspace_id = :ws"),
            {"id": user_id, "ws": owner.workspace_id},
        )
    ).fetchone()
    if target is None:
        raise no_such_person()
    if target.role == role:
        return []
    if target.id == owner.id:
        raise bad_request("You cannot change your own role. Transfer ownership instead.")

    if role == "owner":
        # Exactly one owner: promoting someone demotes the current one.
        await session.execute(
            text("UPDATE users SET role = 'admin' WHERE id = :id"), {"id": owner.id}
        )
    await session.execute(
        text("UPDATE users SET role = :role WHERE id = :id"), {"id": user_id, "role": role}
    )
    # A reset link is checked against the role its target had when it was minted, and
    # lives an hour: one minted for a member must not open the admin — or owner — that
    # member has just become. The outgoing owner's go too.
    changed_emails = (
        await session.execute(
            text("SELECT DISTINCT email FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
            {"ids": [user_id, owner.id] if role == "owner" else [user_id]},
        )
    ).fetchall()
    for row in changed_emails:
        await retire_resets(session, email=row.email)
    if role == "guest":
        # A guest has no reach to lend an assistant (ADR 0034): what they had connected as
        # a member stops, tokens and signed-in grants alike.
        await revoke_assistant_tokens(session, user_id)
    await audit_service.record(
        session,
        owner,
        "user.role_changed",
        target_type="user",
        target_id=user_id,
        metadata={"from": target.role, "to": role},
    )
    changed = (
        await session.execute(
            text(f"SELECT {USER_COLUMNS} FROM users WHERE id = ANY(cast(:ids AS uuid[]))"),
            {"ids": [user_id, owner.id]},
        )
    ).fetchall()
    return [to_user(row) for row in changed]


async def deactivate(session: AsyncSession, admin: Actor, user_id: str) -> User | None:
    if user_id == admin.id:
        raise bad_request("You cannot deactivate your own account.")
    target = (
        await session.execute(
            text("SELECT role FROM users WHERE id = :id AND workspace_id = :ws"),
            {"id": user_id, "ws": admin.workspace_id},
        )
    ).fetchone()
    if target is None:
        raise no_such_person()
    if target.role == "owner":
        raise bad_request("The workspace owner cannot be deactivated.")

    await session.execute(
        text("UPDATE users SET deactivated_at = now() WHERE id = :id"), {"id": user_id}
    )
    await session.execute(text("DELETE FROM sessions WHERE user_id = :id"), {"id": user_id})
    # Their assistant's token too. A deactivated person's token already stops resolving,
    # but leaving it unrevoked means reactivating them would quietly bring it back.
    await revoke_assistant_tokens(session, user_id)
    # The display-name index is partial on `deactivated_at IS NULL`, so deactivating
    # already frees the name. The handle table has to be told, or it would hold a
    # departed account's name against everybody for ever — the exact hostage problem
    # the partial index exists to prevent.
    await handle_service.release_user(session, user_id)
    await audit_service.record(
        session, admin, "user.deactivated", target_type="user", target_id=user_id
    )
    await _turn_off_their_agents(session, admin, user_id)
    return await _user_row(session, user_id)


#: What the console says on an agent turned off this way, so nobody wonders why.
OWNER_DEACTIVATED = "Turned off because its owner was deactivated."


async def _turn_off_their_agents(session: AsyncSession, admin: Actor, user_id: str) -> None:
    """A person's own agents leave with them (ADR 0018).

    Left on, a departed member's assistant kept receiving every event from the rooms its
    bot is in, its token kept answering the bot API and its socket kept connecting, and
    whoever it had been lent to could still set it going — an assistant working for
    somebody who is no longer here. Disabled rather than uninstalled: what it said stays,
    its owner may be reactivated, and every path that reaches an agent already refuses a
    disabled one. Turning it back on is an admin's call, made in the console.
    """
    rows = (
        await session.execute(
            text(
                f"""
                UPDATE plugins
                   SET status = 'disabled', {recent_errors.record_sql("why")},
                       updated_at = now()
                 WHERE owner_user_id = :id AND workspace_id = :ws AND status = 'enabled'
                RETURNING id, slug
                """
            ),
            {"id": user_id, "ws": admin.workspace_id, "why": OWNER_DEACTIVATED},
        )
    ).fetchall()
    for row in rows:
        await audit_service.record(
            session,
            admin,
            "plugin.disabled",
            target_type="plugin",
            target_id=str(row.id),
            metadata={"slug": row.slug, "reason": "owner_deactivated"},
        )


async def reactivate(session: AsyncSession, admin: Actor, user_id: str) -> User | None:
    # Re-claiming the handle is the check. It replaces a probe that read `users` and
    # only `users`, which could not see a *group* that had taken the name in the
    # meantime — the collision no index spanning one table can catch.
    name = (
        await session.execute(
            text(
                "SELECT display_name, placeholder FROM users WHERE id = :id AND workspace_id = :ws"
            ),
            {"id": user_id, "ws": admin.workspace_id},
        )
    ).fetchone()
    if name is None:
        raise no_such_person()
    if name.placeholder:
        # An account an import kept (ADR 0042) is its person's to claim, by an invitation
        # to its address; switched on here it would be an account nobody can sign in to.
        raise bad_request(
            "This person has not joined yet. Invite their address, and the account and "
            "its history become theirs."
        )
    try:
        await handle_service.claim(session, admin.workspace_id, name.display_name, user_id=user_id)
    except Exception as exc:
        if unique_violation(exc):
            raise conflict(
                "That display name is taken now. Rename whoever holds it first.", "name_taken"
            ) from exc
        raise

    await session.execute(
        text("UPDATE users SET deactivated_at = NULL WHERE id = :id AND workspace_id = :ws"),
        {"id": user_id, "ws": admin.workspace_id},
    )
    await audit_service.record(
        session, admin, "user.reactivated", target_type="user", target_id=user_id
    )
    return await _user_row(session, user_id)


async def revoke_sessions(session: AsyncSession, admin: Actor, user_id: str) -> None:
    """Sign someone out of every device without disabling their account."""
    # The workspace check must precede the delete: an admin's reach ends at their own
    # workspace, and a bare user id would let them sign out anyone on the server.
    target = (
        await session.execute(
            text("SELECT role, email FROM users WHERE id = :id AND workspace_id = :ws"),
            {"id": user_id, "ws": admin.workspace_id},
        )
    ).fetchone()
    if target is None:
        raise no_such_person()
    # It now ends their assistant's token too, so it gets the reset link's role rule: an
    # admin repeatedly signing the owner out — and cutting off the owner's assistant —
    # is a nuisance an admin should not be able to cause.
    if user_id != admin.id:
        await _may_act_on(session, admin, target, everywhere=False)
    await session.execute(text("DELETE FROM sessions WHERE user_id = :id"), {"id": user_id})
    # "Every device" includes an assistant holding an MCP token: it reads what this
    # person reads and is not in `sessions`. Without this, a stolen session could mint a
    # year-long token and keep it after an admin signed the account out everywhere —
    # the same reason the person's own "sign out everywhere else" revokes them.
    await revoke_assistant_tokens(session, user_id)
    await audit_service.record(
        session, admin, "user.sessions_revoked", target_type="user", target_id=user_id
    )


async def end_two_step(session: AsyncSession, admin: Actor, user_id: str) -> None:
    """Stop asking somebody for a passkey after their password (ADR 0032).

    The way back for a person who has lost every device their passkeys were on: a reset
    link proves only the inbox, so it does not lift the second step — this does, and it
    is given out like a reset link because it unlocks as much. The passkeys themselves
    stay; the person removes the ones they no longer have.
    """
    person = (
        await session.execute(
            text(
                """
                SELECT id, email, role FROM users
                 WHERE id = :id AND workspace_id = :ws
                   AND deactivated_at IS NULL AND kind = 'human'
                """
            ),
            {"id": user_id, "ws": admin.workspace_id},
        )
    ).fetchone()
    if person is None:
        raise not_found("No such person here.")
    await _may_act_on(session, admin, person, everywhere=True)
    await passkey_service.set_two_step(session, email=person.email, on=False)
    await record_event(session, user_id=str(person.id), kind="two_step_off")
    await audit_service.record(
        session,
        admin,
        "user.two_step_ended",
        target_type="user",
        target_id=str(person.id),
        metadata={"email": person.email},
    )


async def _may_act_on(
    session: AsyncSession, admin: Actor, person: Any, *, everywhere: bool
) -> None:
    """Refuse an admin acting on an account above a member's.

    For a reset link, `everywhere`: a link resets the password on every account its
    address holds and signs whoever opens it in, so minting one is taking the account
    over — and any admin could mint one for the owner, who on a first workspace is also
    the server's administrator: one link from the server console and from switching into
    every other workspace that person belongs to. So an owner's or a server
    administrator's account, or anybody's with accounts in other workspaces (deactivated
    ones too: the reset writes to them), only a server administrator may unlock; an
    admin's, only the owner. Signing somebody out everywhere asks the role half only,
    since it touches this workspace's account alone. A member's stays any admin's to
    unlock, the path the README promises.
    """
    caller = (
        await session.execute(
            text("SELECT role, email FROM users WHERE id = :id"), {"id": admin.id}
        )
    ).fetchone()
    if caller is None:
        raise forbidden()
    if await workspace_service.is_instance_admin(session, caller.email):
        return
    if person.role == "owner":
        if not everywhere:
            raise forbidden("Only a server administrator can sign the owner out.")
        message = "Only a server administrator can reset the owner's password."
        if await mail.probe() == "ok":
            message += " The owner can use “Forgot password” on the sign-in page."
        raise forbidden(message)
    if person.role == "admin" and caller.role != "owner":
        raise forbidden(
            "Only the owner can reset another admin's password."
            if everywhere
            else "Only the owner can sign another admin out."
        )
    if not everywhere:
        return
    if await workspace_service.is_instance_admin(session, person.email):
        raise forbidden("Only a server administrator can reset a server administrator's password.")
    if await workspace_service.has_account_elsewhere(session, person.email, admin.workspace_id):
        raise forbidden(
            "This person has accounts in other workspaces, so only a server administrator"
            " can reset their password."
        )


async def create_reset_link(session: AsyncSession, admin: Actor, user_id: str) -> ResetLinkOut:
    """Mint a password-reset link for somebody, for an admin to hand over.

    The README has always said that without mail "a forgotten password needs an admin",
    and no such path existed: `password_resets` was written in exactly one place, the
    self-service route that emails the link. On a server whose SMTP is not configured —
    which is every server until somebody configures one — that made a forgotten password
    permanent.

    It is the same token the email would have carried, with the same hour of life, so a
    link handed over in person expires like any other. Audited loudly, because an admin
    minting one can take an account over, and the record is what makes that visible.
    """
    person = (
        await session.execute(
            text(
                """
                SELECT id, email, role FROM users
                 WHERE id = :id AND workspace_id = :ws
                   AND deactivated_at IS NULL AND kind = 'human'
                """
            ),
            {"id": user_id, "ws": admin.workspace_id},
        )
    ).fetchone()
    if person is None:
        raise not_found("No such person here.")
    await _may_act_on(session, admin, person, everywhere=True)

    token = new_token()
    row = (
        await session.execute(
            text(
                """
                INSERT INTO password_resets (id, user_id, token_hash, expires_at)
                VALUES (:id, :user_id, :token_hash, now() + interval '1 hour')
                RETURNING expires_at
                """
            ),
            {"id": new_id(), "user_id": person.id, "token_hash": hash_token(token)},
        )
    ).fetchone()
    await audit_service.record(
        session,
        admin,
        "user.reset_link_created",
        target_type="user",
        target_id=str(person.id),
        metadata={"email": person.email},
    )
    return ResetLinkOut(
        url=f"{settings.PUBLIC_URL}/reset/{token}",
        expires_at=iso(row.expires_at) if row else "",
    )


# ─── invitations ──────────────────────────────────────────────────────────────


async def list_invites(session: AsyncSession, workspace_id: str) -> AdminInvitesOut:
    rows = (
        await session.execute(
            text(
                """
                SELECT i.id, i.email, i.role, i.created_by, i.created_at, i.expires_at,
                       i.accepted_at, i.revoked_at,
                       c.display_name AS created_by_name,
                       a.display_name AS accepted_by_name
                  FROM invites i
                  LEFT JOIN users c ON c.id = i.created_by
                  LEFT JOIN users a ON a.id = i.accepted_by
                 WHERE i.workspace_id = :ws
                 ORDER BY i.id DESC
                 LIMIT 200
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    now = _now_iso()

    def status(row: Any) -> str:
        if row.accepted_at:
            return "accepted"
        if row.revoked_at:
            return "revoked"
        return "pending" if require_iso(row.expires_at) > now else "expired"

    return AdminInvitesOut(
        invites=[
            AdminInvite(
                id=row.id,
                email=row.email,
                role=row.role,
                created_by=row.created_by,
                created_by_name=row.created_by_name,
                created_at=require_iso(row.created_at),
                expires_at=require_iso(row.expires_at),
                accepted_at=iso(row.accepted_at),
                accepted_by_name=row.accepted_by_name,
                revoked_at=iso(row.revoked_at),
                status=status(row),
            )
            for row in rows
        ]
    )


async def revoke_invite(session: AsyncSession, admin: Actor, invite_id: str) -> None:
    rows = (
        await session.execute(
            text(
                """
                UPDATE invites SET revoked_at = now()
                 WHERE id = :id AND workspace_id = :ws AND accepted_at IS NULL
                RETURNING id
                """
            ),
            {"id": invite_id, "ws": admin.workspace_id},
        )
    ).fetchall()
    if not rows:
        raise not_found("That invitation is already used or gone.")
    await audit_service.record(
        session, admin, "invite.revoked", target_type="invite", target_id=invite_id
    )


# ─── channels ─────────────────────────────────────────────────────────────────


async def list_channels(session: AsyncSession, workspace_id: str) -> AdminChannelsOut:
    """Every channel, including private ones the admin is not a member of."""
    rows = (
        await session.execute(
            text(
                """
                SELECT c.id, c.kind, c.name, c.topic, c.created_by, c.created_at,
                       c.archived_at,
                       (SELECT count(*) FROM channel_members cm
                         WHERE cm.channel_id = c.id)::int AS member_count,
                       (SELECT count(*) FROM messages m
                         WHERE m.channel_id = c.id AND m.deleted_at IS NULL)::int
                         AS message_count,
                       (SELECT max(m.created_at) FROM messages m
                         WHERE m.channel_id = c.id) AS last_message_at
                  FROM channels c
                 WHERE c.workspace_id = :ws
                 ORDER BY c.kind, lower(c.name) NULLS LAST LIMIT 1000
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    return AdminChannelsOut(
        channels=[
            AdminChannel(
                id=row.id,
                kind=row.kind,
                name=row.name,
                topic=row.topic,
                created_by=row.created_by,
                created_at=require_iso(row.created_at),
                archived_at=iso(row.archived_at),
                member_count=row.member_count,
                message_count=row.message_count,
                last_message_at=iso(row.last_message_at),
            )
            for row in rows
        ]
    )


async def _set_archived(
    session: AsyncSession, admin: Actor, channel_id: str, *, archived: bool
) -> None:
    rows = (
        await session.execute(
            text(
                f"""
                UPDATE channels SET archived_at = {"now()" if archived else "NULL"}
                 WHERE id = :id AND workspace_id = :ws
                   AND kind IN ('public', 'private')
                RETURNING id
                """
            ),
            {"id": channel_id, "ws": admin.workspace_id},
        )
    ).fetchall()
    if not rows:
        raise channel_gone()
    await audit_service.record(
        session,
        admin,
        "channel.archived" if archived else "channel.unarchived",
        target_type="channel",
        target_id=channel_id,
    )


async def archive_channel(session: AsyncSession, admin: Actor, channel_id: str) -> None:
    await _set_archived(session, admin, channel_id, archived=True)


async def unarchive_channel(
    session: AsyncSession, admin: Actor, channel_id: str
) -> ChannelWithState | None:
    """Reopen an archived channel, and return it as the admin sees it.

    Archiving had no undo anywhere: no route, no command, no console button, and nothing
    in the repository that set `archived_at` back to null. The history was intact the
    whole time and simply unreachable for writing, which made a reversible decision
    permanent by omission.
    """
    await _set_archived(session, admin, channel_id, archived=False)
    return await channel_service.get_for_user(session, channel_id, admin.id)


# ─── settings and health ──────────────────────────────────────────────────────


async def get_settings(session: AsyncSession, workspace_id: str) -> WorkspaceSettingsOut:
    row = (
        await session.execute(
            text(
                """
                SELECT w.name, w.slug, COALESCE(s.settings, '{}'::jsonb) AS settings
                  FROM workspaces w
                  LEFT JOIN workspace_settings s ON s.workspace_id = w.id
                 WHERE w.id = :ws
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchone()
    if row is None:
        raise not_found("That workspace no longer exists.")
    return WorkspaceSettingsOut(name=row.name, slug=row.slug, settings=row.settings or {})


async def update_settings(
    session: AsyncSession, admin: Actor, payload: SettingsInput
) -> WorkspaceSettingsOut:
    if payload.name:
        await session.execute(
            text("UPDATE workspaces SET name = :name WHERE id = :ws"),
            {"name": payload.name, "ws": admin.workspace_id},
        )
    if payload.settings is not None:
        # The retention windows have their own route (ADR 0039): it waits a day before a
        # change takes effect, asks for a recent sign-in and audits the before and after,
        # none of which a merge of arbitrary keys here would do.
        if set(payload.settings) & set(RETENTION_KEYS):
            raise bad_request("Retention is set on the Retention page.")
        # Settings merge rather than replace, matching how user prefs behave.
        await session.execute(
            text(
                """
                INSERT INTO workspace_settings (workspace_id, settings, updated_by)
                VALUES (:ws, cast(:settings AS jsonb), :actor)
                ON CONFLICT (workspace_id) DO UPDATE
                  SET settings = workspace_settings.settings || EXCLUDED.settings,
                      updated_at = now(),
                      updated_by = EXCLUDED.updated_by
                """
            ),
            {
                "ws": admin.workspace_id,
                "settings": json.dumps(payload.settings),
                "actor": admin.id,
            },
        )
    await audit_service.record(
        session,
        admin,
        "settings.updated",
        target_type="workspace",
        target_id=admin.workspace_id,
        metadata={"keys": sorted((payload.settings or {}).keys())},
    )
    return await get_settings(session, admin.workspace_id)


async def list_deliveries(
    session: AsyncSession, workspace_id: str, *, limit: int
) -> AdminDeliveriesOut:
    """Every app's recent deliveries, for the console log."""
    rows = (
        await session.execute(
            text(
                """
                SELECT d.id, d.plugin_id, p.name AS plugin_name, d.event, d.status,
                       d.attempts, d.last_status_code, d.last_error,
                       d.created_at, d.delivered_at, d.next_attempt_at
                  FROM plugin_deliveries d
                  JOIN plugins p ON p.id = d.plugin_id
                 WHERE p.workspace_id = :ws
                 ORDER BY d.id DESC
                 LIMIT :limit
                """
            ),
            {"ws": workspace_id, "limit": limit},
        )
    ).fetchall()
    return AdminDeliveriesOut(
        deliveries=[
            AdminDeliveryOut(
                id=row.id,
                plugin_id=row.plugin_id,
                plugin_name=row.plugin_name,
                event=row.event,
                status=row.status,
                attempts=row.attempts,
                last_status_code=row.last_status_code,
                last_error=row.last_error,
                created_at=require_iso(row.created_at),
                delivered_at=iso(row.delivered_at) if row.delivered_at else None,
                next_attempt_at=(
                    iso(row.next_attempt_at)
                    if row.status == "pending" and row.next_attempt_at
                    else None
                ),
            )
            for row in rows
        ]
    )


async def usage_counts(session: AsyncSession, workspace_id: str) -> tuple[int, int]:
    """Messages kept and bytes stored, for the health card."""
    row = (
        await session.execute(
            text(
                """
                SELECT (SELECT count(*) FROM messages
                          WHERE workspace_id = :ws AND deleted_at IS NULL)::int
                         AS messages,
                       (SELECT COALESCE(sum(size_bytes), 0) FROM attachments
                          WHERE workspace_id = :ws)::bigint
                         AS storage
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchone()
    return (row.messages, int(row.storage)) if row else (0, 0)


# ─── webhooks ─────────────────────────────────────────────────────────────────


async def list_webhooks(session: AsyncSession, workspace_id: str) -> WebhooksOut:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, name, channel_id, created_at, last_used_at
                  FROM webhooks WHERE workspace_id = :ws ORDER BY id DESC LIMIT 500
                """
            ),
            {"ws": workspace_id},
        )
    ).fetchall()
    return WebhooksOut(
        webhooks=[
            WebhookOut(
                id=row.id,
                name=row.name,
                channel_id=row.channel_id,
                created_at=require_iso(row.created_at),
                last_used_at=iso(row.last_used_at),
            )
            for row in rows
        ]
    )


async def create_webhook(
    session: AsyncSession, admin: Actor, payload: CreateWebhookInput
) -> WebhookOut:
    """The URL comes back once. The raw token is never recoverable afterwards.

    Into a public channel, or a private one the admin is in — never somebody's DM, and
    never a private channel the admin cannot read: an admin could otherwise put a stranger
    into a conversation they have no part in (the 2026-10 security review). Either answers
    as a channel that is not there, as a private channel's existence always does.
    """
    channel = (
        await session.execute(
            text(
                """
                SELECT c.id FROM channels c
                 WHERE c.id = :id AND c.workspace_id = :ws
                   AND (c.kind = 'public'
                        OR (c.kind = 'private' AND EXISTS (
                              SELECT 1 FROM channel_members cm
                               WHERE cm.channel_id = c.id AND cm.user_id = :admin)))
                """
            ),
            {"id": payload.channel_id, "ws": admin.workspace_id, "admin": admin.id},
        )
    ).fetchone()
    if channel is None:
        raise channel_gone()

    token = new_token()
    webhook_id = new_id()
    row = (
        await session.execute(
            text(
                """
                INSERT INTO webhooks
                  (id, workspace_id, channel_id, name, token_hash, created_by)
                VALUES (:id, :ws, :channel_id, :name, :token_hash, :created_by)
                RETURNING created_at
                """
            ),
            {
                "id": webhook_id,
                "ws": admin.workspace_id,
                "channel_id": payload.channel_id,
                "name": payload.name,
                "token_hash": hash_token(token),
                "created_by": admin.id,
            },
        )
    ).fetchone()
    await audit_service.record(
        session,
        admin,
        "webhook.created",
        target_type="webhook",
        target_id=webhook_id,
        metadata={"name": payload.name},
    )
    return WebhookOut(
        id=webhook_id,
        name=payload.name,
        channel_id=payload.channel_id,
        created_at=require_iso(row.created_at) if row else _now_iso(),
        last_used_at=None,
        url=f"{settings.PUBLIC_URL.rstrip('/')}/api/hooks/{token}",
    )


async def revoke_webhook(session: AsyncSession, admin: Actor, webhook_id: str) -> None:
    rows = (
        await session.execute(
            text("DELETE FROM webhooks WHERE id = :id AND workspace_id = :ws RETURNING id"),
            {"id": webhook_id, "ws": admin.workspace_id},
        )
    ).fetchall()
    if not rows:
        raise not_found("That webhook is already gone.")
    await audit_service.record(
        session, admin, "webhook.revoked", target_type="webhook", target_id=webhook_id
    )
