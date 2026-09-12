"""The signed-in user, the directory, preferences, and the boot payload.

Shape and authorize; `services/users.py` holds the SQL.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..config import settings
from ..db.engine import session_scope, transaction
from ..lib.auth import SessionUser, current_user
from ..lib.errors import bad_request
from ..lib.ids import IdParam
from ..lib.webpush import push as push_all
from ..realtime import hub
from ..schemas.base import CamelModel, OkOut
from ..schemas.models import Bootstrap, CurrentUser, User, UserPrefs
from ..schemas.requests import (
    PushSubscriptionInput,
    PushUnsubscribeInput,
    UpdatePrefsInput,
    UpdateProfileInput,
)
from ..services import themes as theme_service
from ..services import users as user_service

router = APIRouter(tags=["users"])


class UsersOut(CamelModel):
    users: list[User]


class UserOut(CamelModel):
    user: User


class CurrentUserOut(CamelModel):
    user: CurrentUser


class PrefsOut(CamelModel):
    prefs: UserPrefs


@router.get("/api/bootstrap", response_model=Bootstrap)
async def bootstrap(user: SessionUser = Depends(current_user)) -> Bootstrap:
    """One request that returns everything the client needs to render."""
    # Presets are inserted once per workspace, on the first boot that needs them.
    async with transaction() as (setup, _):
        await theme_service.ensure_presets(setup, user.workspace_id)
    async with session_scope() as session:
        return await user_service.bootstrap(session, user)


@router.patch("/api/me", response_model=CurrentUserOut)
async def update_me(
    payload: UpdateProfileInput, user: SessionUser = Depends(current_user)
) -> CurrentUserOut:
    async with transaction() as (session, after):
        me, public = await user_service.update_profile(session, user, payload)
        after.add(
            lambda: hub.to_workspace(
                user.workspace_id,
                {"t": "user.updated", "user": public.model_dump(by_alias=True)},
            )
        )
    return CurrentUserOut(user=me)


@router.patch("/api/me/prefs", response_model=PrefsOut)
async def update_prefs(
    payload: UpdatePrefsInput, user: SessionUser = Depends(current_user)
) -> PrefsOut:
    patch = payload.model_dump(by_alias=True, exclude_unset=True)
    async with transaction() as (session, _):
        prefs = await user_service.update_prefs(session, user.id, patch)
    return PrefsOut(prefs=prefs)


@router.get("/api/users", response_model=UsersOut)
async def list_users(user: SessionUser = Depends(current_user)) -> UsersOut:
    async with session_scope() as session:
        return UsersOut(users=await user_service.list_users(session, user.workspace_id))


@router.get("/api/users/{user_id}", response_model=UserOut)
async def get_user(user_id: IdParam, user: SessionUser = Depends(current_user)) -> UserOut:
    async with session_scope() as session:
        return UserOut(user=await user_service.get_user(session, user.workspace_id, user_id))


# ─── web push ─────────────────────────────────────────────────────────────────
class PushKeyOut(CamelModel):
    #: Null when the server has no VAPID keys — the client shows "not set up" rather
    #: than a subscribe button that cannot work.
    key: str | None


@router.get("/api/me/push-public-key", response_model=PushKeyOut)
async def push_public_key(user: SessionUser = Depends(current_user)) -> PushKeyOut:
    """The VAPID public key a browser needs to subscribe.

    The private half never leaves the server; this is the applicationServerKey handed
    to `pushManager.subscribe`, and it is not a secret — every subscribed browser
    holds it. It still sits behind the session cookie like everything else.
    """
    return PushKeyOut(key=settings.VAPID_PUBLIC_KEY if settings.push_enabled else None)


class PushTestOut(CamelModel):
    ok: bool = True
    #: How many of the caller's devices took it. Zero with `stale` or `failed` set is the
    #: interesting case: the browser thinks it is subscribed and the server disagrees.
    sent: int
    #: Subscriptions the push service says are gone; they have just been deleted.
    stale: int = 0
    #: Endpoints that refused for any other reason — a bad server key, a timeout.
    failed: int = 0


@router.post("/api/me/push-test", response_model=PushTestOut)
async def push_test(user: SessionUser = Depends(current_user)) -> PushTestOut:
    """Send yourself a test notification, so "did I set this up right" has a button.

    The push path crosses VAPID keys, a service worker, an OS permission and a
    third-party push service; when it fails, it fails silently at whichever link is
    broken. A test the person can trigger is the only way to verify the whole chain.
    """
    if not settings.push_enabled:
        raise bad_request("The server has no push keys configured.")
    async with session_scope() as session:
        subs = await user_service.push_subscriptions(session, user.id)
    if not subs:
        return PushTestOut(sent=0)
    result = await push_all(
        subs,
        {
            "title": "Blob",
            "body": "Push works on this device.",
            "url": "/",
            "tag": "push-test",
        },
    )
    if result.dead:
        async with transaction() as (session, _):
            await user_service.forget_push_subscriptions(session, result.dead)
    # Counted, not inferred: a subscription that failed for a reason other than being
    # gone used to be reported as delivered, which is the one answer a test must never
    # give.
    return PushTestOut(sent=result.delivered, stale=len(result.dead), failed=result.failed)


@router.post("/api/me/push-subscription", response_model=OkOut)
async def add_push_subscription(
    payload: PushSubscriptionInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, _):
        await user_service.add_push_subscription(
            session,
            user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
        )
    return OkOut()


@router.delete("/api/me/push-subscription", response_model=OkOut)
async def remove_push_subscription(
    payload: PushUnsubscribeInput, user: SessionUser = Depends(current_user)
) -> OkOut:
    async with transaction() as (session, _):
        await user_service.remove_push_subscription(session, user.id, payload.endpoint)
    return OkOut()


__all__ = ["router"]
