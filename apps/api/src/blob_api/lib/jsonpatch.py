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
from collections.abc import Mapping, Sequence
from typing import Any


class PatchError(ValueError):
    """The patch could not be applied as a whole."""


def apply(document: Any, operations: Sequence[Mapping[str, Any]]) -> Any:
    """Return a new document with every operation applied, or raise `PatchError`."""
    working = copy.deepcopy(document)
    for index, operation in enumerate(operations):
        if not isinstance(operation, Mapping):
            raise PatchError(f"operation {index} is not an object")
        op = operation.get("op")
        path = operation.get("path")
        if not isinstance(path, str):
            raise PatchError(f"operation {index} has no path")
        tokens = _tokens(path)
        if op == "add":
            working = _add(working, tokens, _value_of(operation, index))
        elif op == "replace":
            _get(working, tokens)  # must exist
            working = _remove(working, tokens)
            working = _add(working, tokens, _value_of(operation, index))
        elif op == "remove":
            working = _remove(working, tokens)
        elif op == "move":
            source = _tokens(_from_of(operation, index))
            value = _get(working, source)
            working = _remove(working, source)
            working = _add(working, tokens, value)
        elif op == "copy":
            value = copy.deepcopy(_get(working, _tokens(_from_of(operation, index))))
            working = _add(working, tokens, value)
        elif op == "test":
            if _get(working, tokens) != _value_of(operation, index):
                raise PatchError(f"test at {path!r} failed")
        else:
            raise PatchError(f"operation {index} has unknown op {op!r}")
    return working


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
    if token == "-" and allow_end:
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
