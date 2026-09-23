"""Calls: huddles and meetups — a LiveKit room that belongs to one conversation.

Blob decides who may be in a call and LiveKit carries the media. The rules with teeth:

* A call inherits its conversation's access. Every read and write passes
  `assert_channel_access(require_member=True)`, so a private channel's call answers 404
  to an outsider exactly as the channel does.
* One live call of each kind per conversation. Starting one that is live joins it, and
  the partial unique index `calls_one_live` settles two people clicking at once.
* Who is in a call is kept only while they are: `call_participants` rows go when they
  leave and when the call ends. Blob keeps no attendance history.
* Losing access ends your connection too. LiveKit refreshes a connected participant's
  token itself, so nothing else ever revokes one — the sweep checks each present
  identity against the call's channel before writing the row, and only a clean, definite
  "no longer allowed" removes anyone. A check that fails, times out, or cannot be
  resolved leaves them exactly as they were: ejecting somebody who is still entitled to
  be there is worse than the gap this closes.

LiveKit tells us who joined and when a room closed (`apply_webhook`), and the worker asks
it directly once a minute (`reconcile`) for anything a webhook missed — leased in Redis
so only one sweep is ever doing that at a time.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db.engine import AfterCommit, session_scope, transaction
from ..lib import livekit
from ..lib.auth import SessionUser
from ..lib.errors import AppError, bad_request, forbidden, not_found
from ..lib.ids import looks_like_id, new_id
from ..lib.redis import redis
from ..realtime import hub
from ..schemas.base import iso, require_iso
from ..schemas.calls import Call, CallKind, CallSettings, CallsState, CallToken, MediaServerStatus
from . import audit as audit_service
from . import channels as channel_service
from .audit import Actor
from .workspace_settings import load_calls

log = logging.getLogger(__name__)

COLUMNS = "id, channel_id, kind, created_by, status, created_at, ended_at"
#: When LiveKit last reported anything, for the admin page's "is the webhook arriving".
LAST_EVENT_KEY = "calls:livekit:last_event"
#: The sweep ends a live call whose room LiveKit does not know — but not before its
#: starter has had the time to connect that LiveKit itself allows (`EMPTY_TIMEOUT_S`).
ROOMLESS_GRACE_S = livekit.EMPTY_TIMEOUT_S
#: The lease that keeps sweeps from overlapping. A little over the worker's
#: `job_timeout` (300s): a sweep that finishes, or hits its own budget below, releases
#: this in a `finally` well before it would expire on its own — the expiry only matters
#: if the process is killed outright rather than cancelled, and then it is what stops a
#: dead holder from blocking every sweep after it for good.
SWEEP_LEASE_KEY = "calls:sweep"
SWEEP_LEASE_TTL_S = 310
#: Always under a minute: arq re-enqueues `sweep_calls` every tick regardless of whether
#: the last one finished, so a sweep must give up its slot rather than run into the
#: next one. Hitting this is not an error — the next tick resumes wherever this stopped.
SWEEP_BUDGET_S = 45


def _cols(prefix: str) -> str:
    return ", ".join(f"{prefix}.{name.strip()}" for name in COLUMNS.split(","))


def _to_call(row: Any, participant_ids: list[str] | None = None) -> Call:
    return Call(
        id=str(row.id),
        channel_id=str(row.channel_id),
        kind=row.kind,
        created_by=str(row.created_by),
        status=row.status,
        created_at=require_iso(row.created_at),
        ended_at=iso(row.ended_at),
        participant_ids=participant_ids or [],
    )


def _enabled(config: CallSettings, kind: CallKind) -> bool:
    return config.huddles.enabled if kind == "huddle" else config.meetups.enabled


def _cap(config: CallSettings, kind: CallKind) -> int:
    return config.huddles.max_participants if kind == "huddle" else config.meetups.max_participants


def sources_for(config: CallSettings, kind: CallKind) -> list[str]:
    """What a participant may publish. A meetup is cameras; a huddle is a voice first,
    with the camera and the screen only as the workspace allows."""
    if kind == "meetup":
        return [
            livekit.MICROPHONE,
            livekit.CAMERA,
            livekit.SCREEN_SHARE,
            livekit.SCREEN_SHARE_AUDIO,
        ]
    sources = [livekit.MICROPHONE]
    if config.huddles.cameras:
        sources.append(livekit.CAMERA)
    if config.huddles.screen_share:
        sources += [livekit.SCREEN_SHARE, livekit.SCREEN_SHARE_AUDIO]
    return sources


def _off(kind: CallKind) -> AppError:
    if kind == "huddle":
        return AppError(403, "huddles_off", "Huddles are switched off in this workspace.")
    return AppError(403, "meetups_off", "Video meetups are switched off in this workspace.")


def _not_configured() -> AppError:
    return bad_request("LiveKit is not configured.", code="livekit_not_configured")


def _unavailable() -> AppError:
    return AppError(
        503, "calls_unavailable", "The media server isn't answering. Try again in a moment."
    )


async def _ensure_room(call_id: str, cap: int) -> None:
    try:
        await livekit.rooms.ensure(call_id, cap)
    except livekit.Unavailable as exc:
        log.warning("LiveKit did not create room %s: %s", call_id, exc)
        raise _unavailable() from exc


async def _participants(session: AsyncSession, call_ids: list[str]) -> dict[str, list[str]]:
    if not call_ids:
        return {}
    rows = (
        await session.execute(
            text(
                """
                SELECT call_id, user_id FROM call_participants
                 WHERE call_id = ANY(cast(:ids AS uuid[]))
                 ORDER BY joined_at, user_id
                """
            ),
            {"ids": call_ids},
        )
    ).fetchall()
    people: dict[str, list[str]] = {}
    for row in rows:
        people.setdefault(str(row.call_id), []).append(str(row.user_id))
    return people


async def _get(session: AsyncSession, workspace_id: str, call_id: str) -> Any:
    row = (
        await session.execute(
            text(f"SELECT {COLUMNS} FROM calls WHERE workspace_id = :ws AND id = :id"),
            {"ws": workspace_id, "id": call_id},
        )
    ).fetchone()
    # A meetup from before 0045 could belong to no conversation; nothing can reach one now.
    if row is None or row.channel_id is None:
        raise not_found("That call doesn't exist.")
    return row


async def _live(session: AsyncSession, channel_id: str, kind: CallKind) -> Any:
    return (
        await session.execute(
            text(
                f"SELECT {COLUMNS} FROM calls"
                " WHERE channel_id = :channel_id AND kind = :kind AND status = 'active'"
            ),
            {"channel_id": channel_id, "kind": kind},
        )
    ).fetchone()


async def start(
    session: AsyncSession, after: AfterCommit, user: SessionUser, channel_id: str, kind: CallKind
) -> Call:
    """Start a call of this kind in this conversation — or join the one that is live."""
    await channel_service.assert_channel_access(
        session, user.id, channel_id, require_member=True, require_writable=True
    )
    config = await load_calls(session, user.workspace_id)
    if not _enabled(config, kind):
        raise _off(kind)
    if not livekit.configured():
        raise _not_configured()

    row = (
        await session.execute(
            text(
                f"""
                INSERT INTO calls (id, workspace_id, channel_id, created_by, name, kind)
                VALUES (:id, :ws, :channel_id, :user_id, :name, :kind)
                ON CONFLICT (channel_id, kind) WHERE status = 'active' DO NOTHING
                RETURNING {COLUMNS}
                """
            ),
            {
                "id": new_id(),
                "ws": user.workspace_id,
                "channel_id": channel_id,
                "user_id": user.id,
                "name": "Huddle" if kind == "huddle" else "Meetup",
                "kind": kind,
            },
        )
    ).fetchone()
    if row is None:
        # Somebody started one a moment ago. Theirs is the call; join it.
        live = await _live(session, channel_id, kind)
        if live is None:
            raise _unavailable()
        people = await _participants(session, [str(live.id)])
        return _to_call(live, people.get(str(live.id), []))

    call = _to_call(row)
    # Inside the transaction on purpose: if LiveKit will not make the room, the row goes
    # with it, and nobody is ever offered a call there is no room behind.
    await _ensure_room(call.id, _cap(config, kind))
    payload = {"t": "call.started", "call": call.model_dump(by_alias=True)}
    after.add(lambda: hub.to_channel(call.channel_id, payload))
    return call


async def token(user: SessionUser, call_id: str) -> CallToken:
    """A pass into the call's room, publishing what the workspace allows.

    Opens its own session and releases it before reaching LiveKit, rather than being
    handed one: `_ensure_room` is an outbound `CreateRoom` with its own 5s budget, and
    `/token` is the route that actually joins a call, so holding a pool connection across
    that call would pin connections for as long as LiveKit is reachable but slow to
    answer — and it is the most frequently called route this feature has.
    """
    async with session_scope() as session:
        row = await _get(session, user.workspace_id, call_id)
        await channel_service.assert_channel_access(
            session, user.id, str(row.channel_id), require_member=True
        )
        if row.status != "active":
            raise bad_request("This call has ended.", code="call_ended")
        config = await load_calls(session, user.workspace_id)
        if not _enabled(config, row.kind):
            raise _off(row.kind)
        if not livekit.configured():
            raise _not_configured()
        room_id, cap = str(row.id), _cap(config, row.kind)
        sources = sources_for(config, row.kind)

    await _ensure_room(room_id, cap)
    return CallToken(
        token=livekit.token(user.id, user.display_name, room_id, sources),
        url=livekit.browser_url(),
    )


async def _finish(session: AsyncSession, after: AfterCommit, call_id: str) -> Call | None:
    """Mark a live call ended and forget who was in it. None when it was already over."""
    row = (
        await session.execute(
            text(
                f"""
                UPDATE calls SET status = 'ended', ended_at = now()
                 WHERE id = :id AND status = 'active'
                RETURNING {COLUMNS}
                """
            ),
            {"id": call_id},
        )
    ).fetchone()
    if row is None:
        return None
    await session.execute(
        text("DELETE FROM call_participants WHERE call_id = :id"), {"id": call_id}
    )
    call = _to_call(row)
    payload = {"t": "call.ended", "callId": call.id}
    after.add(lambda: hub.to_channel(call.channel_id, payload))
    return call


async def end(user: SessionUser, call_id: str) -> Call:
    """End a call for everyone: its starter's call to make, or an admin's.

    Opens its own transaction and closes the LiveKit room only once that transaction has
    committed. `AfterCommit.drain()` runs synchronously and inline, so closing the room
    first — a network call with its own 5s budget — used to make COMMIT, and the
    `call.ended` broadcast queued behind it, wait on LiveKit. The router hands this no
    session, so it cannot be tempted back into holding one open across that call.
    """
    async with transaction() as (session, after):
        row = await _get(session, user.workspace_id, call_id)
        await channel_service.assert_channel_access(
            session, user.id, str(row.channel_id), require_member=True
        )
        if str(row.created_by) != user.id and not user.is_admin:
            raise forbidden("Only the person who started a call, or an admin, can end it.")
        ended = await _finish(session, after, str(row.id))
        if ended is None:
            # Somebody else ended it between `_get` and `_finish`; report what is
            # actually there now, not the still-active row this call started with —
            # and there is no fresh close to do, since whoever finished it already did.
            return _to_call(await _get(session, user.workspace_id, call_id))

    # Outside the transaction on purpose (see above). Closing the room is what
    # disconnects everyone still in it. Best effort, and only when there is a LiveKit to
    # ask: the call is over in Blob either way, and the sweep closes any room it finds
    # for an ended call once LiveKit is configured again.
    if livekit.configured():
        try:
            await livekit.rooms.close(ended.id)
        except livekit.Unavailable:
            log.warning("could not close LiveKit room %s", ended.id, exc_info=True)
    return ended


async def state_for(session: AsyncSession, user: SessionUser) -> CallsState:
    """What the client starts from, and resyncs from after a reconnect."""
    config = await load_calls(session, user.workspace_id)
    rows = (
        await session.execute(
            text(
                f"""
                SELECT {_cols("c")} FROM calls c
                  JOIN channel_members m ON m.channel_id = c.channel_id AND m.user_id = :user_id
                 WHERE c.workspace_id = :ws AND c.status = 'active'
                 ORDER BY c.created_at
                """
            ),
            {"user_id": user.id, "ws": user.workspace_id},
        )
    ).fetchall()
    people = await _participants(session, [str(row.id) for row in rows])
    return CallsState(
        available=livekit.configured(),
        settings=config,
        calls=[_to_call(row, people.get(str(row.id), [])) for row in rows],
    )


async def _note_event() -> None:
    try:
        await redis.set(LAST_EVENT_KEY, iso(datetime.now(UTC)) or "", ex=30 * 24 * 3600)
    except Exception:
        log.debug("could not note when LiveKit last reported", exc_info=True)


async def _announce_participants(
    session: AsyncSession, after: AfterCommit, call_id: str, channel_id: str
) -> None:
    ids = (await _participants(session, [call_id])).get(call_id, [])
    payload = {"t": "call.updated", "callId": call_id, "participantIds": ids}
    after.add(lambda: hub.to_channel(channel_id, payload))


_JOINED = "participant_joined"
_LEFT = ("participant_left", "participant_connection_aborted")


async def apply_webhook(event: Any) -> None:
    """One verified event. Anything not about a live call of ours is ignored: LiveKit
    may serve other rooms, and its events arrive after the fact."""
    await _note_event()
    room = event.room.name
    if not looks_like_id(room):
        return
    if event.event == "room_finished":
        async with transaction() as (session, after):
            await _finish(session, after, room)
        return
    if event.event != _JOINED and event.event not in _LEFT:
        return
    identity, sid = event.participant.identity, event.participant.sid
    if not looks_like_id(identity) or not sid:
        return
    async with transaction() as (session, after):
        call = (
            await session.execute(
                text("SELECT channel_id FROM calls WHERE id = :id AND status = 'active'"),
                {"id": room},
            )
        ).fetchone()
        if call is None:
            return
        if event.event == _JOINED:
            changed = (
                await session.execute(
                    text(
                        """
                        INSERT INTO call_participants (call_id, user_id, sid)
                        SELECT :call_id, u.id, :sid FROM users u WHERE u.id = :user_id
                        ON CONFLICT (call_id, user_id) DO UPDATE SET sid = EXCLUDED.sid
                        RETURNING user_id
                        """
                    ),
                    {"call_id": room, "user_id": identity, "sid": sid},
                )
            ).fetchone()
        else:
            # Only this connection: a "left" that arrives after a rejoin names the old one.
            changed = (
                await session.execute(
                    text(
                        """
                        DELETE FROM call_participants
                         WHERE call_id = :call_id AND user_id = :user_id AND sid = :sid
                        RETURNING user_id
                        """
                    ),
                    {"call_id": room, "user_id": identity, "sid": sid},
                )
            ).fetchone()
        if changed is not None:
            await _announce_participants(session, after, room, str(call.channel_id))


async def _still_allowed(
    session: AsyncSession, channel_id: str, identities: list[str]
) -> set[str] | None:
    """Which of `identities` may still be in a call on `channel_id`: a member, and not
    deactivated since they joined. Not `assert_channel_access` — that answers "may this
    request through the door", and never considers deactivation, because a deactivated
    person's own session already stops resolving; this instead has to answer "should the
    connection they made earlier still be open", for someone who is not asking any more.

    `None` means the question could not be answered — a query that raised — and that is
    not the same as "nobody is allowed": the caller must leave everyone exactly as they
    are rather than read a failure as a reason to eject somebody.
    """
    if not identities:
        return set()
    try:
        rows = (
            await session.execute(
                text(
                    """
                    SELECT cm.user_id FROM channel_members cm
                      JOIN users u ON u.id = cm.user_id
                     WHERE cm.channel_id = :channel_id
                       AND cm.user_id = ANY(cast(:ids AS uuid[]))
                       AND u.deactivated_at IS NULL
                    """
                ),
                {"channel_id": channel_id, "ids": identities},
            )
        ).fetchall()
    except Exception:
        log.warning(
            "call sweep: could not check channel access for %s; leaving them alone",
            channel_id,
            exc_info=True,
        )
        return None
    return {str(row.user_id) for row in rows}


async def _replace_participants(
    call_id: str, channel_id: str, present: list[livekit.Participant]
) -> bool:
    candidates = {p.identity: p.sid for p in present if looks_like_id(p.identity)}

    async with session_scope() as session:
        allowed = await _still_allowed(session, channel_id, list(candidates))

    if allowed is None:
        # Inconclusive: change nothing about who is here. This also leaves an identity
        # with no `users` row (never a member, so never in `allowed` either) in `wanted`
        # for this one pass — no worse than today, and the next successful check clears
        # it the ordinary way, below.
        wanted = candidates
    else:
        for identity in candidates:
            if identity in allowed:
                continue
            # Not a member any more, deactivated, or never a real person at all — LiveKit
            # refreshes their token itself, so this sweep is the only thing that ever
            # ends a connection like this one.
            try:
                await livekit.rooms.remove_participant(call_id, identity)
            except livekit.Unavailable:
                log.warning(
                    "call sweep: could not remove %s from %s", identity, call_id, exc_info=True
                )
        wanted = {i: sid for i, sid in candidates.items() if i in allowed}

    async with transaction() as (session, after):
        rows = (
            await session.execute(
                text("SELECT user_id, sid FROM call_participants WHERE call_id = :id"),
                {"id": call_id},
            )
        ).fetchall()
        if {str(row.user_id): row.sid for row in rows} == wanted:
            return False
        await session.execute(
            text(
                """
                DELETE FROM call_participants
                 WHERE call_id = :id AND NOT (user_id = ANY(cast(:keep AS uuid[])))
                """
            ),
            {"id": call_id, "keep": list(wanted)},
        )
        for user_id, sid in wanted.items():
            await session.execute(
                text(
                    """
                    INSERT INTO call_participants (call_id, user_id, sid)
                    SELECT :call_id, u.id, :sid FROM users u WHERE u.id = :user_id
                    ON CONFLICT (call_id, user_id) DO UPDATE SET sid = EXCLUDED.sid
                    """
                ),
                {"call_id": call_id, "user_id": user_id, "sid": sid},
            )
        await _announce_participants(session, after, call_id, channel_id)
    return True


async def reconcile() -> int:
    """Once a minute: make the live calls agree with what LiveKit says, whatever the
    webhooks did or did not deliver. Returns how many calls changed.

    Leased in Redis so at most one sweep ever runs at once. A LiveKit that accepts TCP
    but never answers would otherwise let sweeps pile up across ticks — arq re-enqueues
    `sweep_calls` every minute regardless of whether the last one finished — each pinning
    one of the worker's `max_jobs` slots that notifications, unfurls and plugin delivery
    also need. That is calls degrading something that is not calls, which the workspace
    staying up is supposed to forbid.
    """
    if not livekit.configured():
        return 0
    if not await redis.set(SWEEP_LEASE_KEY, "1", nx=True, ex=SWEEP_LEASE_TTL_S):
        log.debug("call sweep: still running from an earlier tick; skipping this one")
        return 0
    try:
        return await asyncio.wait_for(_reconcile(), timeout=SWEEP_BUDGET_S)
    except TimeoutError:
        # Not an error: the next tick resumes wherever this one stopped.
        log.warning("call sweep: did not finish within %ss; resuming next tick", SWEEP_BUDGET_S)
        return 0
    finally:
        try:
            await redis.delete(SWEEP_LEASE_KEY)
        except Exception:
            log.debug("call sweep: could not release its lease", exc_info=True)


async def _reconcile() -> int:
    try:
        names = await livekit.rooms.names()
    except livekit.Unavailable:
        log.warning("call sweep: LiveKit is not answering", exc_info=True)
        return 0
    ours = [name for name in names if looks_like_id(name)]
    async with session_scope() as session:
        live = (
            await session.execute(
                text("SELECT id, channel_id, created_at FROM calls WHERE status = 'active'")
            )
        ).fetchall()
        leftover = (
            await session.execute(
                text(
                    "SELECT id FROM calls WHERE status = 'ended'"
                    " AND id = ANY(cast(:names AS uuid[]))"
                ),
                {"names": ours},
            )
        ).fetchall()

    changed = 0
    now = datetime.now(UTC)
    for row in live:
        call_id = str(row.id)
        if call_id not in names:
            if (now - row.created_at).total_seconds() < ROOMLESS_GRACE_S:
                continue
            async with transaction() as (session, after):
                if await _finish(session, after, call_id) is not None:
                    changed += 1
            continue
        try:
            present = await livekit.rooms.participants(call_id)
        except livekit.Unavailable:
            continue
        if await _replace_participants(call_id, str(row.channel_id), present):
            changed += 1

    for row in leftover:
        try:
            await livekit.rooms.close(str(row.id))
        except livekit.Unavailable:
            log.warning("call sweep: could not close room %s", row.id, exc_info=True)
    return changed


async def save_settings(
    session: AsyncSession, after: AfterCommit, actor: Actor, value: CallSettings
) -> CallSettings:
    """Replace the workspace's `calls` key and nothing else in its settings."""
    await session.execute(
        text(
            """
            INSERT INTO workspace_settings (workspace_id, settings, updated_by)
            VALUES (:ws, jsonb_build_object('calls', cast(:calls AS jsonb)), :actor)
            ON CONFLICT (workspace_id) DO UPDATE
              SET settings = workspace_settings.settings
                             || jsonb_build_object('calls', cast(:calls AS jsonb)),
                  updated_at = now(),
                  updated_by = EXCLUDED.updated_by
            """
        ),
        {
            "ws": actor.workspace_id,
            "calls": value.model_dump_json(by_alias=True),
            "actor": actor.id,
        },
    )
    await audit_service.record(
        session, actor, "calls.settings_updated", metadata=value.model_dump(by_alias=True)
    )
    workspace_id = actor.workspace_id
    payload = {"t": "calls.settings", "settings": value.model_dump(by_alias=True)}
    after.add(lambda: hub.to_workspace(workspace_id, payload))
    return value


async def media_server_status() -> MediaServerStatus:
    """What the instance admin needs to know about LiveKit, asked of LiveKit itself."""
    webhook_url = f"{settings.PUBLIC_URL.rstrip('/')}/api/calls/livekit"
    if not livekit.configured():
        return MediaServerStatus(configured=False, webhook_url=webhook_url)
    try:
        last_event = await redis.get(LAST_EVENT_KEY)
    except Exception:
        last_event = None
    started = time.perf_counter()
    try:
        open_rooms = len(await livekit.rooms.names())
    except livekit.Unavailable as exc:
        return MediaServerStatus(
            configured=True,
            url=livekit.browser_url(),
            reachable=False,
            # The SDK's message names the address it tried and why; it never holds the key.
            error=str(exc)[:300] or "No answer.",
            last_event_at=last_event,
            webhook_url=webhook_url,
        )
    return MediaServerStatus(
        configured=True,
        url=livekit.browser_url(),
        reachable=True,
        latency_ms=round((time.perf_counter() - started) * 1000),
        open_rooms=open_rooms,
        last_event_at=last_event,
        webhook_url=webhook_url,
    )
