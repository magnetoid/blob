"""Work channels, as the client uses them.

Start one from a message; read the one behind a channel; publish something into it by
hand; finish it. Everything an agent publishes arrives through `jobs/agui.py` (a `CUSTOM`
event) or the bot API, never here.

Access is the channel's. A work channel is private, so somebody who is not in it gets the
same 404 they would get opening the channel — its existence is the private part.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import Field

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import not_found
from ..lib.ids import IdParam
from ..lib.queue import enqueue, fire_and_forget
from ..lib.rate_limit import consume
from ..realtime import hub
from ..schemas.base import CamelModel
from ..services import audit as audit_service
from ..services import channels as channel_service
from ..services import work as work_service
from ..services.audit import actor_for

router = APIRouter(tags=["work"])


class StartWorkInput(CamelModel):
    root_message_id: IdParam
    title: str = Field(min_length=1, max_length=work_service.TITLE_MAX)
    #: The agents to bring. Unowned ones, or your own.
    agent_plugin_ids: list[IdParam] = Field(default_factory=list, max_length=8)


class PublishInput(CamelModel):
    kind: work_service.ArtifactKind
    title: str = Field(min_length=1, max_length=work_service.TITLE_MAX)
    body: str = Field(min_length=1, max_length=work_service.ARTIFACT_BODY_MAX)


class WorkOut(CamelModel):
    work: work_service.Work
    channel: Any = None


class WorkDetailOut(CamelModel):
    work: work_service.Work
    artifacts: list[work_service.Artifact]


class ArtifactOut(CamelModel):
    artifact: work_service.Artifact


class OkOut(CamelModel):
    ok: bool = True


def work_event(work: work_service.Work) -> dict[str, Any]:
    """`work.updated`: the record changed — an artifact landed, or it finished."""
    return {
        "t": "work.updated",
        "workId": work.id,
        "channelId": work.channel_id,
        "status": work.status,
        "artifactCount": work.artifact_count,
    }


@router.post("/api/work", response_model=WorkOut, status_code=201)
async def start_work(
    payload: StartWorkInput, request: Request, user: SessionUser = Depends(current_user)
) -> WorkOut:
    """Spin a channel for this assignment from the message it began with."""
    await consume("send_message", user.id)
    async with transaction() as (session, after):
        started = await work_service.start(
            session,
            after,
            workspace_id=user.workspace_id,
            user_id=user.id,
            root_message_id=payload.root_message_id,
            title=payload.title,
            agent_plugin_ids=payload.agent_plugin_ids,
            public_url=settings.PUBLIC_URL.rstrip("/"),
        )
        channel = await channel_service.get_for_user(session, started.channel_id, user.id)
        await audit_service.record(
            session,
            actor_for(request, user),
            "work.started",
            target_type="work",
            target_id=started.work.id,
            metadata={
                "channelId": started.channel_id,
                "rootMessageId": payload.root_message_id,
                "agents": payload.agent_plugin_ids,
            },
        )
        members = started.member_ids
        channel_id = started.channel_id
        channel_payload = channel.model_dump(by_alias=True) if channel else None

        def broadcast() -> None:
            # Private: announced only to the people (and bots) in it, like any private
            # channel — and each member's own view of it is theirs to fetch.
            if channel_payload is not None:
                hub.to_users(members, {"t": "channel.created", "channel": channel_payload})
            hub.subscribe_users(members, [channel_id])
            fire_and_forget(enqueue("deliver_plugin_events"))

        after.add(broadcast)
    return WorkOut(work=started.work, channel=channel)


@router.get("/api/channels/{channel_id}/work", response_model=WorkDetailOut)
async def work_for_channel(
    channel_id: IdParam, user: SessionUser = Depends(current_user)
) -> WorkDetailOut:
    async with session_scope() as session:
        await channel_service.assert_channel_access(session, user.id, channel_id)
        work = await work_service.by_channel(session, channel_id)
        if work is None:
            raise not_found("That channel is not a work channel.")
        found = await work_service.artifacts(session, work.id)
    return WorkDetailOut(work=work, artifacts=found)


@router.get("/api/work/{work_id}", response_model=WorkDetailOut)
async def read_work(work_id: IdParam, user: SessionUser = Depends(current_user)) -> WorkDetailOut:
    async with session_scope() as session:
        work = await work_service.get(session, work_id, user.workspace_id)
        await channel_service.assert_channel_access(session, user.id, work.channel_id)
        found = await work_service.artifacts(session, work.id)
    return WorkDetailOut(work=work, artifacts=found)


@router.post("/api/work/{work_id}/artifacts", response_model=ArtifactOut, status_code=201)
async def publish_artifact(
    work_id: IdParam,
    payload: PublishInput,
    request: Request,
    user: SessionUser = Depends(current_user),
) -> ArtifactOut:
    """A person puts something into the work by hand — a diff they wrote, a page, notes."""
    await consume("send_message", user.id)
    async with transaction() as (session, after):
        work = await work_service.get(session, work_id, user.workspace_id)
        await channel_service.assert_channel_access(
            session, user.id, work.channel_id, require_member=True, require_writable=True
        )
        artifact = await work_service.publish(
            session,
            work_id=work_id,
            kind=payload.kind,
            title=payload.title,
            body=payload.body,
            author_user_id=user.id,
        )
        updated = await work_service.get(session, work_id, user.workspace_id)
        await audit_service.record(
            session,
            actor_for(request, user),
            "work.artifact_published",
            target_type="work",
            target_id=work_id,
            metadata={"artifactId": artifact.id, "kind": artifact.kind},
        )
        event = work_event(updated)
        after.add(lambda: hub.to_channel(updated.channel_id, event))
    return ArtifactOut(artifact=artifact)


@router.post("/api/work/{work_id}/done", response_model=WorkOut)
async def finish_work(
    work_id: IdParam, request: Request, user: SessionUser = Depends(current_user)
) -> WorkOut:
    """Done. The channel archives; the history stays."""
    async with transaction() as (session, after):
        existing = await work_service.get(session, work_id, user.workspace_id)
        await channel_service.assert_channel_access(
            session, user.id, existing.channel_id, require_member=True
        )
        work = await work_service.finish(
            session,
            work_id=work_id,
            workspace_id=user.workspace_id,
            user_id=user.id,
            is_admin=user.is_admin,
        )
        await audit_service.record(
            session,
            actor_for(request, user),
            "work.finished",
            target_type="work",
            target_id=work_id,
            metadata={"channelId": work.channel_id},
        )
        channel_id = work.channel_id
        event = work_event(work)

        def broadcast() -> None:
            hub.to_channel(channel_id, event)
            hub.to_channel(channel_id, {"t": "channel.archived", "channelId": channel_id})

        after.add(broadcast)
    return WorkOut(work=work)


__all__ = ["router", "work_event"]
