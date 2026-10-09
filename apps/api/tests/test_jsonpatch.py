"""RFC 6902, enough of it to fold an AG-UI STATE_DELTA.

Strict where it has to be: a patch applies whole or not at all, because a resume handed
half a state is handed a state the agent never had.
"""

from __future__ import annotations

import pytest

from blob_api.lib import jsonpatch


def test_the_six_operations() -> None:
    doc = {"a": 1, "list": [1, 2, 3], "nested": {"x": "y"}}
    out = jsonpatch.apply(
        doc,
        [
            {"op": "add", "path": "/b", "value": 2},
            {"op": "replace", "path": "/a", "value": 10},
            {"op": "remove", "path": "/list/0"},
            {"op": "add", "path": "/list/-", "value": 4},
            {"op": "move", "from": "/nested/x", "path": "/moved"},
            {"op": "copy", "from": "/b", "path": "/copied"},
            {"op": "test", "path": "/copied", "value": 2},
        ],
    )
    assert out == {"a": 10, "b": 2, "list": [2, 3, 4], "nested": {}, "moved": "y", "copied": 2}
    # The input was not mutated: the fold keeps the last good state on failure.
    assert doc == {"a": 1, "list": [1, 2, 3], "nested": {"x": "y"}}


def test_pointer_escapes() -> None:
    out = jsonpatch.apply({"a/b": 1, "m~n": 2}, [{"op": "replace", "path": "/a~1b", "value": 3}])
    assert out["a/b"] == 3
    out = jsonpatch.apply(out, [{"op": "remove", "path": "/m~0n"}])
    assert "m~n" not in out


def test_the_whole_document_can_be_replaced() -> None:
    assert jsonpatch.apply({"a": 1}, [{"op": "replace", "path": "", "value": [1]}]) == [1]


@pytest.mark.parametrize(
    "operation",
    [
        {"op": "remove", "path": "/missing"},
        {"op": "replace", "path": "/missing", "value": 1},
        {"op": "add", "path": "/list/9", "value": 1},
        {"op": "add", "path": "/list/notanumber", "value": 1},
        {"op": "test", "path": "/a", "value": "wrong"},
        {"op": "frobnicate", "path": "/a"},
        {"op": "add", "path": "no-leading-slash", "value": 1},
        {"op": "move", "path": "/x"},
        {"op": "add", "path": "/a/deeper", "value": 1},
    ],
)
def test_a_bad_operation_is_refused_whole(operation: dict) -> None:
    with pytest.raises(jsonpatch.PatchError):
        jsonpatch.apply(
            {"a": 1, "list": [1]}, [{"op": "add", "path": "/ok", "value": 1}, operation]
        )


# ─── a patch is bounded while it applies, not after ──────────────────────────
def _doubling_patch(rounds: int) -> list[dict]:
    """Each copy puts the whole document inside itself: the size doubles per operation."""
    return [{"op": "copy", "from": "", "path": f"/r{n}"} for n in range(rounds)]


def test_copying_the_document_into_itself_is_stopped_at_the_budget() -> None:
    import time

    started = time.monotonic()
    with pytest.raises(jsonpatch.PatchTooLargeError):
        jsonpatch.apply({"seed": "x" * 100}, _doubling_patch(18), max_bytes=64 * 1024)
    # Unbounded, these 18 operations built ~60 MB and took seconds on the event loop.
    assert time.monotonic() - started < 0.5


def test_a_patch_that_fits_still_applies() -> None:
    patched = jsonpatch.apply({"a": 1}, _doubling_patch(2), max_bytes=64 * 1024)
    assert patched["r0"] == {"a": 1}
    assert patched["r1"]["r0"] == {"a": 1}


def test_replacing_and_removing_free_their_space() -> None:
    big = "y" * 900
    document = {"slot": big}
    # Replacing the 900-byte value over and over never accumulates: the old one goes.
    patch = [{"op": "replace", "path": "/slot", "value": big} for _ in range(50)]
    assert jsonpatch.apply(document, patch, max_bytes=2_000) == {"slot": big}
    freed = jsonpatch.apply(
        document,
        [{"op": "remove", "path": "/slot"}, {"op": "add", "path": "/other", "value": big}],
        max_bytes=1_000,
    )
    assert freed == {"other": big}


def test_a_value_cannot_be_moved_into_its_own_child() -> None:
    with pytest.raises(jsonpatch.PatchError):
        jsonpatch.apply({"a": {"b": 1}}, [{"op": "move", "from": "/a", "path": "/a/c"}])


def test_too_many_operations_are_refused_whole() -> None:
    patch = [{"op": "test", "path": "", "value": {}}] * (jsonpatch.MAX_OPERATIONS + 1)
    with pytest.raises(jsonpatch.PatchError):
        jsonpatch.apply({}, patch)


def test_without_a_budget_the_document_is_unbounded_as_before() -> None:
    assert jsonpatch.apply({"a": 1}, _doubling_patch(3))["r2"]["r1"]["r0"] == {"a": 1}
