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
