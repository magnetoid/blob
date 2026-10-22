"""Importing a Slack export (ADR 0042): the admin page's calls.

Upload, read, choose, start, watch, and invite the people who came over. Every call that
changes something asks for a recent sign-in, as an export does (ADR 0031): an import
writes a whole team's history and makes accounts. Watching one does not — an import of
years runs longer than a step-up lasts, and the page polls it.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, require_admin, require_recent_admin
from ..lib.errors import bad_request, conflict, not_found, unique_violation
from ..lib.ids import IdParam
from ..lib.queue import enqueue, fire_and_forget
from ..lib.rate_limit import consume
from ..lib.storage import delete_object, ensure_bucket, object_size, presign_upload
from ..schemas.base import CamelModel, iso, require_iso
from ..services import audit as audit_service
from ..services import slack_history as history_service
from ..services import slack_import as import_service
from ..services.audit import actor_for

router = APIRouter()


class ImportPreviewOut(CamelModel):
    """What the zip holds, read before anything is written."""

    public_channels: int = 0
    private_channels: int = 0
    direct_messages: int = 0
    group_messages: int = 0
    #: Days of history: one conversation's one day each, as Slack's export counts them.
    public_days: int = 0
    private_days: int = 0
    #: Slack's people, not its apps, and not those deleted in Slack.
    people: int = 0
    #: Of those, already members here, matched by address.
    matched: int = 0
    #: Of those, arriving as placeholders until they are invited.
    placeholders: int = 0
    #: People the export has no address for: names on old messages, never claimable.
    without_address: int = 0
    apps: int = 0
    #: Public channels that already exist here; their history merges into them.
    merging: list[str] = Field(default_factory=list)


class ImportProgressOut(CamelModel):
    conversations: int = 0
    conversations_total: int = 0
    messages: int = 0
    files_copied: int = 0
    files_skipped: int = 0
    people_created: int = 0
    people_matched: int = 0


class ImportOut(CamelModel):
    id: str
    #: uploading | reading | ready | running | done | failed | cancelled
    status: str
    bytes: int | None = None
    include_private: bool
    copy_files: bool
    preview: ImportPreviewOut | None = None
    progress: ImportProgressOut
    problems: list[str]
    error: str | None = None
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    requested_by_name: str


class ImportStateOut(CamelModel):
    #: The newest import, or none yet.
    current: ImportOut | None = None
    #: The largest zip this server takes.
    max_bytes: int
    #: The largest file an import copies.
    max_file_bytes: int


class ImportCreateIn(CamelModel):
    size_bytes: int = Field(gt=0)


class ImportCreatedOut(CamelModel):
    current: ImportOut
    #: Where the browser PUTs the zip: this size, `application/zip`, and nothing else.
    upload_url: str


class ImportStartIn(CamelModel):
    include_private: bool = False
    copy_files: bool = True


class ImportPersonOut(CamelModel):
    user_id: str
    name: str
    email: str
    #: An invitation to this address is out and not yet accepted.
    invited: bool = False


class ImportPeopleOut(CamelModel):
    people: list[ImportPersonOut]


class ImportInviteIn(CamelModel):
    user_ids: list[str] = Field(min_length=1, max_length=500)


class ImportInvitedOut(CamelModel):
    invited: int


def _out(row: Any) -> ImportOut:
    return ImportOut(
        id=str(row.id),
        status=row.status,
        bytes=row.bytes,
        include_private=row.include_private,
        copy_files=row.copy_files,
        preview=ImportPreviewOut.model_validate(row.preview) if row.preview else None,
        progress=ImportProgressOut.model_validate(row.progress or {}),
        problems=[str(problem) for problem in (row.problems or [])],
        error=row.error,
        created_at=require_iso(row.created_at),
        started_at=iso(row.started_at),
        finished_at=iso(row.finished_at),
        requested_by_name=row.requested_by_name,
    )


async def _state(workspace_id: str) -> ImportStateOut:
    async with session_scope() as session:
        row = await import_service.latest(session, workspace_id)
    return ImportStateOut(
        current=_out(row) if row else None,
        max_bytes=settings.SLACK_IMPORT_MAX_BYTES,
        max_file_bytes=settings.SLACK_IMPORT_MAX_FILE_BYTES,
    )


@router.get("/api/admin/import", response_model=ImportStateOut)
async def import_state(user: SessionUser = Depends(require_admin)) -> ImportStateOut:
    return await _state(user.workspace_id)


@router.post("/api/admin/import", response_model=ImportCreatedOut)
async def create_import(
    payload: ImportCreateIn, request: Request, user: SessionUser = Depends(require_recent_admin)
) -> ImportCreatedOut:
    """A place for the zip, and the address to put it at."""
    if payload.size_bytes > settings.SLACK_IMPORT_MAX_BYTES:
        raise bad_request(
            "That export is larger than this server takes. Ask its administrator to raise "
            "SLACK_IMPORT_MAX_BYTES.",
            code="invalid_input",
        )
    await consume("import", user.id)
    # As an upload ticket does (`routers/files`): on a fresh server an import may be the
    # first thing ever put in the bucket.
    await ensure_bucket()
    async with transaction() as (session, after):
        import_id, replaced = await import_service.create(
            session,
            workspace_id=user.workspace_id,
            requested_by=user.id,
            size_bytes=payload.size_bytes,
        )

        def drop_replaced() -> None:
            for key in replaced:
                fire_and_forget(delete_object(key))

        after.add(drop_replaced)
        row = await import_service.get(session, user.workspace_id, import_id)
    url = presign_upload(row.object_key, "application/zip", payload.size_bytes)
    return ImportCreatedOut(current=_out(row), upload_url=url)


@router.post("/api/admin/import/{import_id}/uploaded", response_model=ImportStateOut)
async def import_uploaded(
    import_id: IdParam, user: SessionUser = Depends(require_recent_admin)
) -> ImportStateOut:
    """The zip is in the bucket: read it."""
    async with transaction() as (session, after):
        row = await import_service.get(session, user.workspace_id, import_id)
        if row is None:
            raise not_found("There is no such import.")
        stored = await object_size(row.object_key)
        if stored is None or stored != row.bytes:
            raise bad_request("The upload did not finish. Choose the file again.")
        if not await import_service.move(
            session, user.workspace_id, import_id, from_="uploading", to="reading"
        ):
            raise conflict("This import has already been read.", "import_state")
        after.add(lambda: fire_and_forget(enqueue("slack_import_read", import_id)))
    return await _state(user.workspace_id)


@router.post("/api/admin/import/{import_id}/start", response_model=ImportStateOut)
async def start_import(
    import_id: IdParam,
    payload: ImportStartIn,
    request: Request,
    user: SessionUser = Depends(require_recent_admin),
) -> ImportStateOut:
    async with transaction() as (session, after):
        try:
            started = await import_service.begin(
                session,
                user.workspace_id,
                import_id,
                include_private=payload.include_private,
                copy_files=payload.copy_files,
            )
        except Exception as exc:
            if unique_violation(exc):
                raise conflict(
                    "Another import is running. Wait for it to finish.", "import_running"
                ) from exc
            raise
        if not started:
            raise conflict("This import is not ready to start.", "import_state")
        await audit_service.record(
            session,
            actor_for(request, user),
            "import.started",
            target_type="workspace",
            target_id=user.workspace_id,
            metadata={
                "source": "slack",
                "includePrivate": payload.include_private,
                "copyFiles": payload.copy_files,
            },
        )
        after.add(lambda: fire_and_forget(enqueue("slack_import_step", import_id)))
    return await _state(user.workspace_id)


@router.post("/api/admin/import/{import_id}/cancel", response_model=ImportStateOut)
async def cancel_import(
    import_id: IdParam, request: Request, user: SessionUser = Depends(require_recent_admin)
) -> ImportStateOut:
    async with transaction() as (session, after):
        row = await import_service.cancel(session, user.workspace_id, import_id)
        if row is None:
            raise conflict("This import has already ended.", "import_state")
        await audit_service.record(
            session,
            actor_for(request, user),
            "import.cancelled",
            target_type="workspace",
            target_id=user.workspace_id,
            metadata={"source": "slack", "was": row.status},
        )
        # A running step notices on its next batch and stops; the zip, which holds every
        # file link's token, goes now.
        key = row.object_key
        after.add(lambda: fire_and_forget(delete_object(key)))
    return await _state(user.workspace_id)


@router.get("/api/admin/import/{import_id}/people", response_model=ImportPeopleOut)
async def import_people(
    import_id: IdParam, user: SessionUser = Depends(require_admin)
) -> ImportPeopleOut:
    """Who this import brought over that nobody has invited yet."""
    async with session_scope() as session:
        if await import_service.get(session, user.workspace_id, import_id) is None:
            raise not_found("There is no such import.")
        rows = await history_service.invitable(session, user.workspace_id, import_id)
    return ImportPeopleOut(
        people=[
            ImportPersonOut(
                user_id=str(r.id), name=r.display_name, email=r.email, invited=r.invited
            )
            for r in rows
        ]
    )


@router.post("/api/admin/import/{import_id}/invite", response_model=ImportInvitedOut)
async def invite_imported(
    import_id: IdParam,
    payload: ImportInviteIn,
    request: Request,
    user: SessionUser = Depends(require_recent_admin),
) -> ImportInvitedOut:
    """Invite the people an import brought over, each to their own address. Accepting
    one hands its person their history (ADR 0042). The mail goes from the worker."""
    await consume("import_invite", user.id)
    async with transaction() as (session, after):
        if await import_service.get(session, user.workspace_id, import_id) is None:
            raise not_found("There is no such import.")
        sent = await history_service.invite(
            session,
            actor_for(request, user),
            workspace_id=user.workspace_id,
            import_id=import_id,
            user_ids=payload.user_ids,
            inviter_name=user.display_name,
        )

        def mail_them() -> None:
            for job in sent:
                fire_and_forget(enqueue("send_import_invite", job))

        after.add(mail_them)
    return ImportInvitedOut(invited=len(sent))
