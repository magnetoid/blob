"""Errors from browsers (ADR 0025's addendum): reported by whoever is signed in, read and
cleared by the workspace's admins on the Health page.

A report is a diagnostic, not a request anybody waits on: the client sends it and forgets
it, a person's reports are capped at sixty an hour, and what is kept is cut down first
(`services/client_errors.py`).
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from ..lib import metrics
from ..lib.auth import SessionUser, current_user, require_admin
from ..lib.rate_limit import consume
from ..schemas.base import CamelModel, OkOut
from ..services import client_errors as client_error_service

router = APIRouter()


class ClientErrorIn(CamelModel):
    message: str = Field(max_length=4000)
    stack: str | None = Field(default=None, max_length=20000)
    #: The client's own path when it threw — `location.pathname`, no query.
    path: str = Field(default="", max_length=2000)
    #: The client build's commit, so a fault is placed in a release.
    release: str | None = Field(default=None, max_length=100)


class ClientErrorOut(CamelModel):
    fingerprint: str
    message: str
    stack: str
    path: str
    release: str | None = None
    browser: str
    count: int
    first_at: str
    last_at: str


class ClientErrorsOut(CamelModel):
    errors: list[ClientErrorOut]


def _iso(at: float) -> str:
    return datetime.fromtimestamp(at, UTC).isoformat()


@router.post("/api/client-errors", response_model=OkOut)
async def report_client_error(
    payload: ClientErrorIn, request: Request, user: SessionUser = Depends(current_user)
) -> OkOut:
    await consume("client_error", user.id)
    await client_error_service.record(
        user.workspace_id,
        message=payload.message,
        stack=payload.stack,
        path=payload.path,
        release=payload.release,
        user_agent=request.headers.get("user-agent", ""),
    )
    metrics.tally.count(metrics.CLIENT_ERRORS, {})
    return OkOut()


@router.get("/api/admin/client-errors", response_model=ClientErrorsOut)
async def list_client_errors(admin: SessionUser = Depends(require_admin)) -> ClientErrorsOut:
    faults = await client_error_service.recent(admin.workspace_id)
    return ClientErrorsOut(
        errors=[
            ClientErrorOut(
                fingerprint=fault.fingerprint,
                message=fault.message,
                stack=fault.stack,
                path=fault.path,
                release=fault.release,
                browser=fault.browser,
                count=fault.count,
                first_at=_iso(fault.first_at),
                last_at=_iso(fault.last_at),
            )
            for fault in faults
        ]
    )


@router.delete("/api/admin/client-errors", response_model=OkOut)
async def clear_client_errors(admin: SessionUser = Depends(require_admin)) -> OkOut:
    await client_error_service.clear(admin.workspace_id)
    return OkOut()
