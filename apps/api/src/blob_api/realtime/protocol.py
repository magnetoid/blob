"""The wire protocol, declared once on this side.

`packages/shared/src/protocol.ts` is the other half. The two are hand-written — the
socket carries a discriminated union that generating from OpenAPI would not describe —
so the only thing keeping them honest is that they are both compared, by
`tests/test_protocol_parity.py`, against each other.

Before this existed the event names were string literals scattered through routers and
services, and the timings lived in three modules. A name could be renamed on one side and
the drift would surface as an event the client silently ignored: no error, no test, just
a message that never appears until someone reloads.
"""

from __future__ import annotations

#: Every frame the server sends, matching the `t` values of ServerEvent in protocol.ts.
SERVER_EVENTS: frozenset[str] = frozenset(
    {
        "hello",
        "pong",
        "message.new",
        "message.updated",
        "message.deleted",
        "reaction.added",
        "reaction.removed",
        "thread.updated",
        "channel.created",
        "channel.updated",
        "channel.archived",
        "member.joined",
        "member.left",
        "typing",
        "presence",
        "user.updated",
        "group.upserted",
        "group.deleted",
        "group.membership",
        "read_state.updated",
        "reminder.due",
        "agent_run.started",
        "agent_run.updated",
        "agent_run.finished",
        "error",
    }
)

#: Every frame the client sends, matching ClientFrame in protocol.ts.
CLIENT_FRAMES: frozenset[str] = frozenset(
    {
        "ping",
        "presence.sub",
        "typing",
        "channel.focus",
    }
)

WS_PATH = "/ws"

#: Client heartbeat interval; the server drops a connection after 2 missed beats.
HEARTBEAT_MS = 25_000

#: Typing indicator lifetime, matched by the Redis key TTL.
TYPING_TTL_MS = 5_000

#: A client may send at most one typing frame per this interval.
TYPING_THROTTLE_MS = 3_000

#: Above this many missed messages in one channel, tell the client to refetch instead.
MAX_REPLAY_PER_CHANNEL = 200

__all__ = [
    "CLIENT_FRAMES",
    "HEARTBEAT_MS",
    "MAX_REPLAY_PER_CHANNEL",
    "SERVER_EVENTS",
    "TYPING_THROTTLE_MS",
    "TYPING_TTL_MS",
    "WS_PATH",
]
