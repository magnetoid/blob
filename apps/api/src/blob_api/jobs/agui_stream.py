"""What a run shows while it is running: the live card, and the Stop button.

`CardBroadcaster` throttles the run card's snapshots onto the channel; `wait_for_cancel`
is the other side of the Stop button, waiting on the Redis channel the cancel route
publishes to. Both are job-side — they reach the hub — which is why they sit beside
`jobs/agui.py` rather than in `plugins/`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from contextlib import suppress
from typing import Any

from ..plugins import run_card
from ..realtime import hub


class CardBroadcaster:
    """Live snapshots of a run's card, at most ~4 a second.

    The throttle is load-bearing: a chatty agent emits hundreds of deltas a second,
    and each snapshot fans out to every socket in the channel. Snapshots rather than
    deltas so a client that reconnects mid-run renders the next one whole. The final
    state travels with `agent_run.finished`, so nothing is lost to the trailing edge.
    """

    def __init__(self, run_id: str, channel_id: str, card: run_card.CardFold) -> None:
        self._run_id = run_id
        self._channel_id = channel_id
        self._card = card
        self._dirty = False
        self._task: asyncio.Task[None] | None = None

    def on_event(self, event: Mapping[str, Any]) -> None:
        if not self._card.feed(event):
            return
        self._dirty = True
        if self._task is None:
            self._task = asyncio.create_task(self._flush_loop())

    async def _flush_loop(self) -> None:
        while True:
            await asyncio.sleep(0.25)
            if not self._dirty:
                continue
            self._dirty = False
            hub.to_channel(
                self._channel_id,
                {
                    "t": "agent_run.updated",
                    "runId": self._run_id,
                    "channelId": self._channel_id,
                    "card": self._card.snapshot(),
                },
            )

    async def stop(self) -> None:
        if self._task is None:
            return
        self._task.cancel()
        with suppress(asyncio.CancelledError):
            await self._task


async def wait_for_cancel(pubsub: Any) -> None:
    """Returns when a cancel is published for this run. Runs until cancelled itself."""
    while True:
        try:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A Redis blip must not end the watch — Stop should still work after it.
            await asyncio.sleep(1.0)
            continue
        if message is not None and message.get("type") == "message":
            return
