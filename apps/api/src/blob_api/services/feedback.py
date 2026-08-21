"""Feedback tickets.

A ticket is filed by anyone in the workspace and read by admins. What makes it useful
is not the prose but what the browser attached to it: the console log, and a snapshot of
the page as the reporter saw it.

The snapshot goes to object storage rather than into the row. It is markup measured in
hundreds of kilobytes, it is read once when someone opens the ticket, and keeping it out
of the table keeps the list query cheap.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..db.engine import transaction
from ..lib.errors import not_found
from ..lib.ids import new_id
from ..lib.storage import delete_object, put_object
from ..schemas.models import FeedbackTicket
from ..schemas.requests import FeedbackInput
from . import audit as audit_service
from .audit import Actor
from .serialize import to_feedback_ticket

log = logging.getLogger("blob.feedback")

COLUMNS = """
    id, kind, title, body, status, reporter_id, environment, console_log,
    snapshot_key, created_at, resolved_at, resolved_by
"""


def _snapshot_key(workspace_id: str, ticket_id: str) -> str:
    return f"{workspace_id}/feedback/{ticket_id}.html"


async def create(
    workspace_id: str, reporter_id: str, payload: FeedbackInput
) -> FeedbackTicket:
    ticket_id = new_id()
    key: str | None = None

    # The upload happens before the insert so a ticket never points at an object that is
    # not there. An orphaned object if the insert fails is the cheaper failure.
    #
    # And it is not allowed to be fatal: someone reporting a bug must not be told their
    # report failed because object storage is unreachable. The words and the console log
    # are the part that always survives; the snapshot is a bonus.
    if payload.snapshot.strip():
        candidate = _snapshot_key(workspace_id, ticket_id)
        try:
            await put_object(candidate, payload.snapshot.encode("utf-8"), "text/html")
            key = candidate
        except Exception:
            log.warning("could not store the snapshot for ticket %s", ticket_id, exc_info=True)

    async with transaction() as (session, _):
        row = (
            await session.execute(
                text(
                    f"""
                    INSERT INTO feedback_tickets
                      (id, workspace_id, reporter_id, kind, title, body,
                       environment, console_log, snapshot_key)
                    VALUES
                      (:id, :ws, :reporter_id, :kind, :title, :body,
                       cast(:environment AS jsonb), :console_log, :snapshot_key)
                    RETURNING {COLUMNS}
                    """
                ),
                {
                    "id": ticket_id,
                    "ws": workspace_id,
                    "reporter_id": reporter_id,
                    "kind": payload.kind,
                    "title": payload.title.strip(),
                    "body": payload.body.strip(),
                    "environment": _json(payload.environment),
                    "console_log": payload.console_log,
                    "snapshot_key": key,
                },
            )
        ).fetchone()

    assert row is not None
    return to_feedback_ticket(row)


async def listing(
    session: AsyncSession, workspace_id: str, status: str | None = None
) -> list[FeedbackTicket]:
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {COLUMNS}
                  FROM feedback_tickets
                 WHERE workspace_id = :ws
                   -- Cast explicitly: asyncpg cannot infer a parameter's type when its
                   -- only other use is a comparison against NULL.
                   AND (cast(:status AS text) IS NULL OR status = cast(:status AS text))
                 ORDER BY created_at DESC
                 LIMIT 200
                """
            ),
            {"ws": workspace_id, "status": status},
        )
    ).fetchall()
    return [to_feedback_ticket(row) for row in rows]


async def set_status(actor: Actor, ticket_id: str, status: str) -> FeedbackTicket:
    async with transaction() as (session, _):
        row = (
            await session.execute(
                text(
                    f"""
                    UPDATE feedback_tickets
                       SET status = :status,
                           resolved_at = CASE WHEN :status = 'closed' THEN now() ELSE NULL END,
                           resolved_by = CASE WHEN :status = 'closed' THEN cast(:actor AS uuid)
                                              ELSE NULL END
                     WHERE id = :id AND workspace_id = :ws
                    RETURNING {COLUMNS}
                    """
                ),
                {
                    "id": ticket_id,
                    "ws": actor.workspace_id,
                    "status": status,
                    "actor": actor.id,
                },
            )
        ).fetchone()

        if row is None:
            raise not_found("No such ticket.")

        # In the same transaction as the change it describes, so the log cannot record
        # something that was rolled back.
        await audit_service.record(
            session,
            actor,
            "feedback.status_changed",
            target_type="feedback_ticket",
            target_id=ticket_id,
            metadata={"status": status},
        )

    return to_feedback_ticket(row)


async def snapshot_key_for(
    session: AsyncSession, workspace_id: str, ticket_id: str
) -> str:
    row = (
        await session.execute(
            text(
                "SELECT snapshot_key FROM feedback_tickets WHERE id = :id AND workspace_id = :ws"
            ),
            {"id": ticket_id, "ws": workspace_id},
        )
    ).fetchone()
    if row is None or not row.snapshot_key:
        raise not_found("That ticket has no snapshot.")
    return str(row.snapshot_key)


async def remove(actor: Actor, ticket_id: str) -> None:
    async with transaction() as (session, _):
        row = (
            await session.execute(
                text(
                    """
                    DELETE FROM feedback_tickets
                     WHERE id = :id AND workspace_id = :ws
                    RETURNING snapshot_key
                    """
                ),
                {"id": ticket_id, "ws": actor.workspace_id},
            )
        ).fetchone()

        if row is None:
            raise not_found("No such ticket.")

        await audit_service.record(
            session,
            actor,
            "feedback.deleted",
            target_type="feedback_ticket",
            target_id=ticket_id,
        )

    # Past the commit: a failed delete here leaves an orphan object, which is tidier
    # than a ticket whose snapshot has already gone — and it must not turn a successful
    # deletion into an error the admin sees.
    if row.snapshot_key:
        try:
            await delete_object(str(row.snapshot_key))
        except Exception:
            log.warning("could not remove the snapshot for ticket %s", ticket_id, exc_info=True)


def _json(value: dict[str, str]) -> str:
    # Bounded: the environment map is whatever the browser chose to send.
    return json.dumps({str(k)[:60]: str(v)[:500] for k, v in list(value.items())[:20]})


__all__ = ["create", "listing", "remove", "set_status", "snapshot_key_for"]
