"""The two halves of the wire protocol must agree.

`packages/shared/src/protocol.ts` and `blob_api.realtime.protocol` are written by hand on
purpose — the socket carries a discriminated union that generating from OpenAPI would not
describe. Hand-written on both sides means nothing enforces that they match, and the
failure is silent: rename an event on the server and the client simply ignores a frame it
no longer recognises. No error, no failing request, just a message that never appears.

So this parses the TypeScript and compares it. It is the cheapest possible substitute for
a shared schema, and it catches the whole class of drift that actually happens.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from blob_api.realtime import protocol

PROTOCOL_TS = Path(__file__).resolve().parents[3] / "packages" / "shared" / "src" / "protocol.ts"


@pytest.fixture(scope="module")
def source() -> str:
    assert PROTOCOL_TS.is_file(), f"{PROTOCOL_TS} has moved; this test needs the new path"
    return PROTOCOL_TS.read_text(encoding="utf-8")


def _union_block(source: str, name: str) -> str:
    """The body of `export type <name> = ... ;`.

    Scanned with brace depth rather than matched with a regex: the members are objects
    whose own fields end in semicolons, so the first `;` is nowhere near the end of the
    declaration.
    """
    start = source.find(f"export type {name} =")
    assert start != -1, f"{name} is no longer declared in protocol.ts"

    depth = 0
    for index in range(start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        elif char == ";" and depth == 0:
            return source[start:index]
    raise AssertionError(f"{name} has no terminating semicolon")


def _event_names(block: str) -> set[str]:
    """Every `t` literal, including the `'a' | 'b'` form used for paired events."""
    names: set[str] = set()
    for clause in re.findall(r"t:\s*((?:'[a-z_.]+'\s*\|?\s*)+)", block):
        names.update(re.findall(r"'([a-z_.]+)'", clause))
    return names


def _constant(source: str, name: str) -> str:
    match = re.search(rf"export const {name} = ([^;]+);", source)
    assert match, f"{name} is no longer exported from protocol.ts"
    return match.group(1).strip()


def test_the_server_events_match(source: str) -> None:
    declared = _event_names(_union_block(source, "ServerEvent"))
    assert declared, "no events parsed — the shape of protocol.ts changed"

    only_ts = declared - protocol.SERVER_EVENTS
    only_py = protocol.SERVER_EVENTS - declared
    assert not only_ts, f"the client expects events the server does not declare: {sorted(only_ts)}"
    assert not only_py, f"the server declares events the client ignores: {sorted(only_py)}"


def test_the_client_frames_match(source: str) -> None:
    declared = _event_names(_union_block(source, "ClientFrame"))
    assert declared, "no frames parsed — the shape of protocol.ts changed"
    assert declared == set(protocol.CLIENT_FRAMES)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("HEARTBEAT_MS", protocol.HEARTBEAT_MS),
        ("TYPING_TTL_MS", protocol.TYPING_TTL_MS),
        ("TYPING_THROTTLE_MS", protocol.TYPING_THROTTLE_MS),
        ("MAX_REPLAY_PER_CHANNEL", protocol.MAX_REPLAY_PER_CHANNEL),
    ],
)
def test_the_timings_match(source: str, name: str, value: int) -> None:
    """A drifted timing is worse than a drifted name: nothing breaks, it just misbehaves.

    A heartbeat the client sends more slowly than the server tolerates disconnects
    everybody, and a typing TTL shorter than the throttle makes the indicator flicker.
    """
    # TypeScript writes these with numeric separators.
    declared = int(_constant(source, name).replace("_", ""))
    assert declared == value, f"{name} is {declared} in protocol.ts and {value} in Python"


def test_the_socket_path_matches(source: str) -> None:
    assert _constant(source, "WS_PATH").strip("'\"") == protocol.WS_PATH


def test_every_declared_event_is_actually_emitted() -> None:
    """A declaration nobody sends is drift too, just in the other direction.

    Catches an event removed from the server while its name stayed in both protocol
    files — the test above would still pass, and the client would keep handling a frame
    that can never arrive.
    """
    api_src = Path(__file__).resolve().parents[1] / "src" / "blob_api"
    body = "\n".join(
        path.read_text(encoding="utf-8")
        for path in api_src.rglob("*.py")
        if "__pycache__" not in path.parts and path.name != "protocol.py"
    )

    # 'error' is produced by the error handler rather than named as an event literal.
    never_emitted = {
        name
        for name in protocol.SERVER_EVENTS - {"error"}
        if f'"{name}"' not in body and f"'{name}'" not in body
    }
    assert not never_emitted, f"declared but never sent: {sorted(never_emitted)}"
