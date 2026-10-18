"""RFC 6902 JSON Patch, enough of it to fold an AG-UI `STATE_DELTA`.

AG-UI carries an agent's shared state as one `STATE_SNAPSHOT` followed by `STATE_DELTA`
events whose `delta` is a JSON Patch. Blob keeps the folded state so a run that stopped to
ask a question can be resumed with what the agent knew when it asked. That needs the six
operations and RFC 6901 pointers, and nothing else — so this is written here rather than
adding a dependency for forty lines.

Pure, and strict where the spec is: a bad path or a failed `test` raises `PatchError` and
the caller keeps the last good state. Silently applying half a patch would hand the agent
back a state it never had.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence
from typing import Any


class PatchError(ValueError):
    """The patch could not be applied as a whole."""


class PatchTooLargeError(PatchError):
    """The patch would grow the document past the caller's limit."""


#: Far more than any real delta carries. A cap on its own does not bound the work —
#: the byte budget below does that — but it keeps a patch from being a loop.
MAX_OPERATIONS = 1000

#: How far past `max_bytes` the document may get *between* operations. A swap written
#: as add-then-remove passes through more than it ends with; only the end is held to
#: `max_bytes` exactly.
HEADROOM = 2

#: How many times `max_bytes` one patch may copy and measure in all. Growth is bounded
#: by the size budget, but a copy that lands where it came from never grows anything
#: and still costs a deep copy and a serialisation: a thousand of those on a 60 KB state
#: held the worker's event loop for over a minute. This bounds the work itself.
WORK_FACTOR = 16


def apply(
    document: Any, operations: Sequence[Mapping[str, Any]], *, max_bytes: int | None = None
) -> Any:
    """Return a new document with every operation applied, or raise `PatchError`.

    `max_bytes` bounds the document *while* the patch applies, not after it. Checking
    only the result let `copy` from the root into a child double the document per
    operation: eighteen operations, under a kilobyte of patch, built sixty megabytes on
    the worker's event loop before any check ran. The running size is the JSON length
    of what each operation adds, swaps or removes — close to the true length, and
    always computed from bounded pieces. It may reach `HEADROOM` times the limit between
    operations and must end within it, and everything one patch measures in all is
    capped at `WORK_FACTOR` times the limit, so a patch that grows nothing — a thousand
    same-size replaces — cannot spend the loop either.
    """
    if len(operations) > MAX_OPERATIONS:
        raise PatchError(f"a patch of more than {MAX_OPERATIONS} operations")
    working = copy.deepcopy(document)
    budget = _Budget(max_bytes)
    size = budget.measure(working)
    for index, operation in enumerate(operations):
        if not isinstance(operation, Mapping):
            raise PatchError(f"operation {index} is not an object")
        op = operation.get("op")
        path = operation.get("path")
        if not isinstance(path, str):
            raise PatchError(f"operation {index} has no path")
        tokens = _tokens(path)
        grows = 0
        if op == "add":
            value = _value_of(operation, index)
            grows = budget.measure(value) - budget.measure(_replaced(working, tokens))
            working = _add(working, tokens, value)
        elif op == "replace":
            old = _get(working, tokens)  # must exist
            value = _value_of(operation, index)
            grows = budget.measure(value) - budget.measure(old)
            working = _remove(working, tokens)
            working = _add(working, tokens, value)
        elif op == "remove":
            grows = -budget.measure(_get(working, tokens))
            working = _remove(working, tokens)
        elif op == "move":
            source = _tokens(_from_of(operation, index))
            # RFC 6902 §4.4: a value cannot be moved into one of its own children.
            if tokens[: len(source)] == source and len(tokens) > len(source):
                raise PatchError(f"operation {index} moves a value into itself")
            value = _get(working, source)
            working = _remove(working, source)
            working = _add(working, tokens, value)
        elif op == "copy":
            source = _tokens(_from_of(operation, index))
            value = _get(working, source)
            if source == tokens:
                continue  # a copy onto itself changes nothing, so it costs nothing either
            grows = budget.measure(value) - budget.measure(_replaced(working, tokens))
            budget.check_growth(size + grows, index)  # before the copy, not after it
            working = _add(working, tokens, copy.deepcopy(value))
        elif op == "test":
            value = _value_of(operation, index)
            budget.measure(value)
            if _get(working, tokens) != value:
                raise PatchError(f"test at {path!r} failed")
        else:
            raise PatchError(f"operation {index} has unknown op {op!r}")
        size += grows
        budget.check_growth(size, index)
    budget.check_final(size)
    return working


class _Budget:
    """What one patch may measure and grow to. Inert when there is no `max_bytes`."""

    def __init__(self, max_bytes: int | None) -> None:
        self.max_bytes = max_bytes
        self.work_left = max_bytes * WORK_FACTOR if max_bytes is not None else 0

    def measure(self, value: Any) -> int:
        """The JSON length of `value`, charged to the patch's work."""
        if self.max_bytes is None or value is _NOTHING:
            return 0
        size = _json_size(value, self.max_bytes)
        self.work_left -= size
        if self.work_left < 0:
            raise PatchTooLargeError("the patch is more work than a patch gets")
        return size

    def check_growth(self, size: int, index: int) -> None:
        if self.max_bytes is not None and size > self.max_bytes * HEADROOM:
            raise PatchTooLargeError(f"operation {index} grows the document too far")

    def check_final(self, size: int) -> None:
        if self.max_bytes is not None and size > self.max_bytes:
            raise PatchTooLargeError("the patched document is over its limit")


#: What `_replaced` answers when an `add` overwrites nothing.
_NOTHING = object()


def _json_size(value: Any, max_bytes: int) -> int:
    """The JSON length of `value`; anything that cannot be measured counts as too big."""
    try:
        return len(json.dumps(value, separators=(",", ":"), default=str))
    except (TypeError, ValueError, RecursionError):
        return max_bytes + 1


def _replaced(document: Any, tokens: list[str]) -> Any:
    """What an `add` at `tokens` overwrites: the whole document at the root, a member
    that already exists in an object, and nothing when it inserts into an array."""
    if not tokens:
        return document
    try:
        parent = _get(document, tokens[:-1])
    except PatchError:
        return _NOTHING
    if isinstance(parent, dict) and tokens[-1] in parent:
        return parent[tokens[-1]]
    return _NOTHING


def _value_of(operation: Mapping[str, Any], index: int) -> Any:
    if "value" not in operation:
        raise PatchError(f"operation {index} has no value")
    return operation["value"]


def _from_of(operation: Mapping[str, Any], index: int) -> str:
    source = operation.get("from")
    if not isinstance(source, str):
        raise PatchError(f"operation {index} has no from")
    return source


def _tokens(pointer: str) -> list[str]:
    """RFC 6901: '' is the whole document; otherwise '/'-separated, ~1 → /, ~0 → ~."""
    if pointer == "":
        return []
    if not pointer.startswith("/"):
        raise PatchError(f"pointer {pointer!r} does not start with '/'")
    return [part.replace("~1", "/").replace("~0", "~") for part in pointer[1:].split("/")]


def _index(container: list[Any], token: str, *, allow_end: bool) -> int:
    if token == "-" and allow_end:  # noqa: S105 — a JSON Pointer token, not a secret
        return len(container)
    if not token.isdigit():
        raise PatchError(f"{token!r} is not an array index")
    position = int(token)
    limit = len(container) + (1 if allow_end else 0)
    if position >= limit:
        raise PatchError(f"index {position} is out of range")
    return position


def _get(document: Any, tokens: list[str]) -> Any:
    node = document
    for token in tokens:
        if isinstance(node, dict):
            if token not in node:
                raise PatchError(f"no member {token!r}")
            node = node[token]
        elif isinstance(node, list):
            node = node[_index(node, token, allow_end=False)]
        else:
            raise PatchError(f"cannot descend into a scalar at {token!r}")
    return node


def _add(document: Any, tokens: list[str], value: Any) -> Any:
    if not tokens:
        return value
    parent = _get(document, tokens[:-1])
    last = tokens[-1]
    if isinstance(parent, dict):
        parent[last] = value
    elif isinstance(parent, list):
        parent.insert(_index(parent, last, allow_end=True), value)
    else:
        raise PatchError(f"cannot add under a scalar at {last!r}")
    return document


def _remove(document: Any, tokens: list[str]) -> Any:
    if not tokens:
        return None
    parent = _get(document, tokens[:-1])
    last = tokens[-1]
    if isinstance(parent, dict):
        if last not in parent:
            raise PatchError(f"no member {last!r} to remove")
        del parent[last]
    elif isinstance(parent, list):
        del parent[_index(parent, last, allow_end=False)]
    else:
        raise PatchError(f"cannot remove from a scalar at {last!r}")
    return document


__all__ = ["PatchError", "apply"]
