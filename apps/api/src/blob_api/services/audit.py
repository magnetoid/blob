"""The audit log.

Append-only, written by every admin mutation and every sensitive act. This is not
prevention — it is forensics, which is the thing you actually want when someone asks
"who removed them, and when?".
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..lib.auth import SessionUser
from ..lib.ids import new_id
from ..schemas.base import CamelModel, require_iso

# Actions are dotted and past-tense, so the log reads as a sentence with the actor.
ACTIONS = (
    "agent.summary_generated",
    "agent.task_created",
    "agent.task_updated",
    "bot.channel_joined",
    "bot.message_deleted",
    "bot.message_posted",
    "bot.message_updated",
    "bot.reaction_added",
    "bot.reaction_removed",
    "user.role_changed",
    "user.deactivated",
    "user.reactivated",
    "user.profile_edited",
    "user.sessions_revoked",
    "user.password_reset_forced",
    "invite.created",
    "invite.revoked",
    "channel.archived",
    "channel.deleted",
    "channel.renamed",
    "message.deleted",
    "emoji.added",
    "emoji.deleted",
    "group.created",
    "group.renamed",
    "group.deleted",
    "group.member_added",
    "group.member_removed",
    "webhook.created",
    "webhook.revoked",
    "settings.updated",
    "theme.saved",
    "theme.deleted",
    "plugin.installed",
    "plugin.updated",
    "plugin.approved",
    "plugin.enabled",
    "plugin.disabled",
    "plugin.secret_rotated",
    "plugin.token_issued",
    "plugin.tokens_revoked",
    "plugin.uninstalled",
    "plugin.redeployed",
    "plugin.stopped",
    "plugin.env_updated",
    # A root shell inside an agent's container. Recorded on the way in as well as the way
    # out, because the sessions worth having a log of are the ones that did not end
    # tidily — and an open with no close says that on its own.
    "plugin.shell_opened",
    "plugin.shell_closed",
    "feedback.status_changed",
    "feedback.deleted",
)


@dataclass(slots=True)
class Actor:
    id: str
    workspace_id: str
    ip: str | None = None


def actor_for(request: Request, user: SessionUser) -> Actor:
    """Who did it, and from where. The address is what makes the log forensic."""
    return Actor(
        id=user.id,
        workspace_id=user.workspace_id,
        ip=request.client.host if request.client else None,
    )


class AuditEntry(CamelModel):
    id: str
    action: str
    actor_id: str | None
    actor_name: str | None
    target_type: str | None
    target_id: str | None
    target_label: str | None
    metadata: dict[str, Any]
    ip: str | None
    created_at: str


async def record(
    session: AsyncSession,
    actor: Actor,
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    await session.execute(
        text(
            """
            INSERT INTO audit_events
              (id, workspace_id, actor_id, action, target_type, target_id, metadata, ip)
            VALUES (:id, :ws, :actor_id, :action, :target_type, cast(:target_id AS uuid),
                    cast(:metadata AS jsonb), cast(:ip AS inet))
            """
        ),
        {
            "id": new_id(),
            "ws": actor.workspace_id,
            "actor_id": actor.id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "metadata": json.dumps(metadata or {}),
            "ip": actor.ip,
        },
    )


async def list_events(
    session: AsyncSession,
    workspace_id: str,
    *,
    actor_id: str | None = None,
    action: str | None = None,
    before: str | None = None,
    limit: int = 50,
) -> list[AuditEntry]:
    """Newest first. UUIDv7 ids sort chronologically, so `before` is a keyset cursor."""
    rows = (
        await session.execute(
            text(
                """
                SELECT a.id, a.action, a.actor_id, u.display_name AS actor_name,
                       a.target_type, a.target_id, a.metadata, a.ip, a.created_at,
                       COALESCE(tu.display_name, tc.name) AS target_label
                  FROM audit_events a
                  LEFT JOIN users u ON u.id = a.actor_id
                  LEFT JOIN users tu ON tu.id = a.target_id AND a.target_type = 'user'
                  LEFT JOIN channels tc ON tc.id = a.target_id AND a.target_type = 'channel'
                 WHERE a.workspace_id = :ws
                   AND (cast(:actor_id AS uuid) IS NULL OR a.actor_id = cast(:actor_id AS uuid))
                   AND (cast(:action AS text) IS NULL OR a.action = :action)
                   AND (cast(:before AS uuid) IS NULL OR a.id < cast(:before AS uuid))
                 ORDER BY a.id DESC
                 LIMIT :limit
                """
            ),
            {
                "ws": workspace_id,
                "actor_id": actor_id,
                "action": action,
                "before": before,
                "limit": limit,
            },
        )
    ).fetchall()

    return [
        AuditEntry(
            id=row.id,
            action=row.action,
            actor_id=row.actor_id,
            actor_name=row.actor_name,
            target_type=row.target_type,
            target_id=row.target_id,
            target_label=row.target_label,
            metadata=row.metadata or {},
            ip=str(row.ip) if row.ip else None,
            created_at=require_iso(row.created_at),
        )
        for row in rows
    ]
