"""Web push fan-out, shared by the notify job and the settings screen's test button."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Sequence
from typing import Any

from ..config import settings

log = logging.getLogger("blob.lib.webpush")


async def send_push(subs: Sequence[Any], payload: dict[str, Any]) -> list[str]:
    """Fan out web push, returning subscriptions the browser has thrown away."""
    from pywebpush import WebPushException, webpush

    dead: list[str] = []

    def _one(sub: Any) -> str | None:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT},
            )
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            # 404/410 mean the browser threw the subscription away; stop trying.
            if status in (404, 410):
                return str(sub.id)
            log.warning("push failed: %s", exc)
        return None

    results = await asyncio.gather(
        *(asyncio.to_thread(_one, sub) for sub in subs), return_exceptions=True
    )
    for result in results:
        if isinstance(result, str):
            dead.append(result)
    return dead
